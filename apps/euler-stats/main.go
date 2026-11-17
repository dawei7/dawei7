package main

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"github.com/dawei7/dawei7/apps/euler-stats/github"
	"github.com/dawei7/dawei7/apps/euler-stats/notify"
	"github.com/dawei7/dawei7/apps/euler-stats/play"
	"github.com/dawei7/dawei7/apps/euler-stats/poller"
)

const (
	defaultPlayPackage = "com.mathn.tablet"
	defaultPlayBucket  = "pubsite_prod_7498353165123168775"
)

//go:embed all:frontend/dist
var staticFiles embed.FS

type analyticsReader interface {
	Ping(ctx context.Context) error
	PollHistoryBounds(ctx context.Context) (*time.Time, *time.Time, error)
	GetOverview(ctx context.Context, p db.QueryParams) (db.OverviewResponse, error)
	GetTimeSeries(ctx context.Context, p db.QueryParams) (db.TimeSeriesResponse, error)
	GetAssets(ctx context.Context, p db.QueryParams, mode db.AssetMode, sortBy, sortDir string) ([]db.AssetRow, error)
	GetItemVersions(ctx context.Context, releaseTag, itemKey string) ([]db.AssetRow, error)
	GetPollRuns(ctx context.Context, limit int) ([]db.PollRunRow, error)

	PlayDateBounds(ctx context.Context) (*time.Time, *time.Time, error)
	GetPlayOverview(ctx context.Context, pkgName string, fromDate, toDate time.Time, filter db.PlayFilter, playEnabled bool) (db.PlayOverviewResponse, error)
	GetPlayTimeSeries(ctx context.Context, pkgName string, gran db.Granularity, from, to time.Time, loc *time.Location, tzName string, filter db.PlayFilter) (db.PlayTimeSeriesResponse, error)
	GetPlayReviews(ctx context.Context, pkgName string, limit int) ([]db.PlayReviewView, error)
	GetPlayVitals(ctx context.Context, pkgName string, limit int) ([]db.PlayVitalsSummaryRow, error)
	GetPlayPollRuns(ctx context.Context, limit int) ([]db.PlayPollRunRow, error)
}

type pollRunner interface {
	PollOnce(ctx context.Context) (poller.PollResult, error)
}

type playSyncRunner interface {
	SyncOnce(ctx context.Context) (play.SyncResult, error)
}

type notificationManager interface {
	GetOverview(ctx context.Context, limit int, adminProtected bool) (notify.NotificationStatusResponse, error)
	UpdateSettings(ctx context.Context, upd db.NotificationSettingsUpdate) (db.NotificationSettings, error)
	SendTest(ctx context.Context) (db.NotificationLogEntry, error)
}

type appConfig struct {
	adminSecret string
	playPackage string
	playEnabled bool
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.ConnectWithRetry(rootCtx, 20*time.Second)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	if err := db.Migrate(rootCtx, pool); err != nil {
		log.Fatalf("migrate db: %v", err)
	}

	store := db.NewStore(pool)
	playPkg := strings.TrimSpace(os.Getenv("PLAY_PACKAGE_NAME"))
	if playPkg == "" {
		playPkg = defaultPlayPackage
	}
	playBucket := strings.TrimSpace(os.Getenv("PLAY_BUCKET_NAME"))
	if playBucket == "" {
		playBucket = defaultPlayBucket
	}

	adminSecret := os.Getenv("ADMIN_SECRET")

	mailer := notify.NewSMTPMailerFromEnv()
	notifier := notify.NewService(store, mailer, playPkg, os.Getenv("NOTIFY_DASHBOARD_URL"))

	if ov, err := notifier.GetOverview(rootCtx, 1, adminSecret != ""); err != nil {
		log.Printf("notifications initialization warning: %v", err)
	} else {
		log.Printf("notifications ready: recipient=%s smtp_configured=%v (%s:%s from %s)",
			ov.Settings.RecipientEmail, ov.SMTP.Configured, ov.SMTP.Host, ov.SMTP.Port, ov.SMTP.Username)
	}

	ghClient := github.NewClient(os.Getenv("GITHUB_TOKEN"))
	collector := poller.New(ghClient, store)
	collector.SetOnPollSuccess(func(ctx context.Context, res poller.PollResult) {
		notifier.CheckAndNotifyDownloads(ctx, res)
	})

	go collector.RunScheduler(rootCtx)

	var playSyncer playSyncRunner
	playEnabled := false
	ts, err := play.LoadTokenSourceFromEnv()
	if err != nil {
		log.Printf("Google Play service account configuration error: %v", err)
	} else if ts != nil {
		playClient := play.NewClient(ts, playBucket, playPkg)
		ps := play.NewSyncer(playClient, store, playPkg)
		ps.SetOnSyncSuccess(func(ctx context.Context, _ play.SyncResult) {
			notifier.CheckAndNotifyPlayCrashes(ctx)
		})
		playSyncer = ps
		playEnabled = true
		go ps.RunScheduler(rootCtx)
		log.Printf("Google Play hourly syncer enabled for %s (bucket %s)", playPkg, playBucket)
	} else {
		log.Printf("Google Play sync disabled (no service account configured)")
	}

	cfg := appConfig{
		adminSecret: adminSecret,
		playPackage: playPkg,
		playEnabled: playEnabled,
	}
	mux := newMux(store, collector, playSyncer, notifier, cfg)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-rootCtx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("euler-stats listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("http server: %v", err)
	}
}

func authorizeAdmin(w http.ResponseWriter, r *http.Request, adminSecret string) bool {
	if adminSecret == "" {
		jsonError(w, "admin endpoint disabled (ADMIN_SECRET not set)", http.StatusForbidden)
		return false
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(token), []byte(adminSecret)) != 1 {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func newMux(
	store analyticsReader,
	collector pollRunner,
	playSyncer playSyncRunner,
	notifier notificationManager,
	cfg appConfig,
) *http.ServeMux {
	mux := http.NewServeMux()

	healthHandler := func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := store.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"status": "degraded",
				"error":  err.Error(),
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("GET /api/health", healthHandler)

	mux.HandleFunc("GET /api/overview", func(w http.ResponseWriter, r *http.Request) {
		params, errMsg := parseQueryParams(r, store)
		if errMsg != "" {
			jsonError(w, errMsg, http.StatusBadRequest)
			return
		}
		res, err := store.GetOverview(r.Context(), params)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	mux.HandleFunc("GET /api/timeseries", func(w http.ResponseWriter, r *http.Request) {
		params, errMsg := parseQueryParams(r, store)
		if errMsg != "" {
			jsonError(w, errMsg, http.StatusBadRequest)
			return
		}
		res, err := store.GetTimeSeries(r.Context(), params)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	mux.HandleFunc("GET /api/assets", func(w http.ResponseWriter, r *http.Request) {
		params, errMsg := parseQueryParams(r, store)
		if errMsg != "" {
			jsonError(w, errMsg, http.StatusBadRequest)
			return
		}
		q := r.URL.Query()
		mode, ok := db.ParseAssetMode(q.Get("mode"))
		if !ok {
			jsonError(w, "invalid mode (use items or files)", http.StatusBadRequest)
			return
		}
		rows, err := store.GetAssets(r.Context(), params, mode, q.Get("sort"), q.Get("dir"))
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"assets": rows,
			"mode":   mode,
			"count":  len(rows),
		})
	})

	mux.HandleFunc("GET /api/item-versions", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		releaseTag := strings.TrimSpace(q.Get("release"))
		itemKey := strings.TrimSpace(q.Get("item_key"))
		if releaseTag == "" || itemKey == "" {
			jsonError(w, "release and item_key are required", http.StatusBadRequest)
			return
		}
		rows, err := store.GetItemVersions(r.Context(), releaseTag, itemKey)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"versions": rows,
			"count":    len(rows),
		})
	})

	mux.HandleFunc("GET /api/polls", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		rows, err := store.GetPollRuns(r.Context(), limit)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"polls": rows,
			"count": len(rows),
		})
	})

	mux.HandleFunc("GET /api/export.csv", func(w http.ResponseWriter, r *http.Request) {
		params, errMsg := parseQueryParams(r, store)
		if errMsg != "" {
			jsonError(w, errMsg, http.StatusBadRequest)
			return
		}
		kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
		if kind == "" {
			kind = "timeseries"
		}
		switch kind {
		case "timeseries":
			ts, err := store.GetTimeSeries(r.Context(), params)
			if err != nil {
				jsonError(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeTimeSeriesCSV(w, ts)
		case "assets":
			q := r.URL.Query()
			mode, ok := db.ParseAssetMode(q.Get("mode"))
			if !ok {
				jsonError(w, "invalid mode (use items or files)", http.StatusBadRequest)
				return
			}
			rows, err := store.GetAssets(r.Context(), params, mode, q.Get("sort"), q.Get("dir"))
			if err != nil {
				jsonError(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeAssetsCSV(w, rows)
		default:
			jsonError(w, "invalid export type (use timeseries or assets)", http.StatusBadRequest)
		}
	})

	mux.HandleFunc("POST /api/poll", func(w http.ResponseWriter, r *http.Request) {
		if !authorizeAdmin(w, r, cfg.adminSecret) {
			return
		}
		if collector == nil {
			jsonError(w, "poller unavailable", http.StatusServiceUnavailable)
			return
		}
		res, err := collector.PollOnce(r.Context())
		if err != nil {
			jsonError(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	// ── Google Play Store Endpoints ──────────────────────────────────────────

	mux.HandleFunc("GET /api/play/overview", func(w http.ResponseWriter, r *http.Request) {
		params, filter, errMsg := parsePlayQueryParams(r, store)
		if errMsg != "" {
			jsonError(w, errMsg, http.StatusBadRequest)
			return
		}
		fromDate := calendarDateInLoc(params.From, params.Loc)
		toDate := calendarDateInLoc(params.To, params.Loc)
		res, err := store.GetPlayOverview(r.Context(), cfg.playPackage, fromDate, toDate, filter, cfg.playEnabled)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	mux.HandleFunc("GET /api/play/timeseries", func(w http.ResponseWriter, r *http.Request) {
		params, filter, errMsg := parsePlayQueryParams(r, store)
		if errMsg != "" {
			jsonError(w, errMsg, http.StatusBadRequest)
			return
		}
		res, err := store.GetPlayTimeSeries(r.Context(), cfg.playPackage, params.Granularity, params.From, params.To, params.Loc, params.TZName, filter)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	mux.HandleFunc("GET /api/play/reviews", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		rows, err := store.GetPlayReviews(r.Context(), cfg.playPackage, limit)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"reviews": rows,
			"count":   len(rows),
		})
	})

	mux.HandleFunc("GET /api/play/vitals", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		rows, err := store.GetPlayVitals(r.Context(), cfg.playPackage, limit)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"vitals": rows,
			"count":  len(rows),
		})
	})

	mux.HandleFunc("GET /api/play/polls", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		rows, err := store.GetPlayPollRuns(r.Context(), limit)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"polls": rows,
			"count": len(rows),
		})
	})

	mux.HandleFunc("GET /api/play/export.csv", func(w http.ResponseWriter, r *http.Request) {
		params, filter, errMsg := parsePlayQueryParams(r, store)
		if errMsg != "" {
			jsonError(w, errMsg, http.StatusBadRequest)
			return
		}
		kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
		if kind == "" {
			kind = "timeseries"
		}
		switch kind {
		case "timeseries":
			ts, err := store.GetPlayTimeSeries(r.Context(), cfg.playPackage, params.Granularity, params.From, params.To, params.Loc, params.TZName, filter)
			if err != nil {
				jsonError(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writePlayTimeSeriesCSV(w, ts)
		case "countries":
			fromDate := calendarDateInLoc(params.From, params.Loc)
			toDate := calendarDateInLoc(params.To, params.Loc)
			ov, err := store.GetPlayOverview(r.Context(), cfg.playPackage, fromDate, toDate, db.PlayFilter{}, cfg.playEnabled)
			if err != nil {
				jsonError(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writePlayCountriesCSV(w, ov.ByCountry)
		default:
			jsonError(w, "invalid export type (use timeseries or countries)", http.StatusBadRequest)
		}
	})

	mux.HandleFunc("POST /api/play/poll", func(w http.ResponseWriter, r *http.Request) {
		if !authorizeAdmin(w, r, cfg.adminSecret) {
			return
		}
		if playSyncer == nil {
			jsonError(w, "Google Play syncer disabled", http.StatusServiceUnavailable)
			return
		}
		res, err := playSyncer.SyncOnce(r.Context())
		if err != nil {
			jsonError(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	// ── Email Notification Service Endpoints ─────────────────────────────────

	mux.HandleFunc("GET /api/notifications", func(w http.ResponseWriter, r *http.Request) {
		if notifier == nil {
			jsonError(w, "notifications service unavailable", http.StatusServiceUnavailable)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		res, err := notifier.GetOverview(r.Context(), limit, cfg.adminSecret != "")
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	mux.HandleFunc("PUT /api/notifications/settings", func(w http.ResponseWriter, r *http.Request) {
		if !authorizeAdmin(w, r, cfg.adminSecret) {
			return
		}
		if notifier == nil {
			jsonError(w, "notifications service unavailable", http.StatusServiceUnavailable)
			return
		}
		var upd db.NotificationSettingsUpdate
		if err := json.NewDecoder(r.Body).Decode(&upd); err != nil {
			jsonError(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		updated, err := notifier.UpdateSettings(r.Context(), upd)
		if err != nil {
			jsonError(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, updated)
	})

	mux.HandleFunc("POST /api/notifications/test", func(w http.ResponseWriter, r *http.Request) {
		if !authorizeAdmin(w, r, cfg.adminSecret) {
			return
		}
		if notifier == nil {
			jsonError(w, "notifications service unavailable", http.StatusServiceUnavailable)
			return
		}
		entry, sendErr := notifier.SendTest(r.Context())
		statusCode := http.StatusOK
		if sendErr != nil && entry.Status == "error" {
			statusCode = http.StatusBadGateway
		}
		writeJSON(w, statusCode, map[string]any{
			"entry": entry,
			"error": entry.ErrorMessage,
		})
	})

	// Embedded React SPA + PWA static assets
	sub, err := fs.Sub(staticFiles, "frontend/dist")
	if err != nil {
		log.Fatalf("embed sub: %v", err)
	}
	mux.Handle("GET /", newSPAHandler(sub))

	return mux
}

func newSPAHandler(sub fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			jsonError(w, "not found", http.StatusNotFound)
			return
		}
		clean := strings.TrimPrefix(r.URL.Path, "/")
		if clean == "" {
			clean = "index.html"
		}
		if _, err := fs.Stat(sub, clean); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			w.Header().Set("Cache-Control", "no-cache")
			fileServer.ServeHTTP(w, r2)
			return
		}
		switch {
		case strings.HasPrefix(clean, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case strings.HasPrefix(clean, "icons/"):
			w.Header().Set("Cache-Control", "public, max-age=604800")
		case clean == "manifest.webmanifest":
			w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
		case clean == "sw.js":
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
		default:
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func parseQueryParams(r *http.Request, store analyticsReader) (db.QueryParams, string) {
	q := r.URL.Query()
	gran, ok := db.ParseGranularity(q.Get("granularity"))
	if !ok {
		return db.QueryParams{}, "invalid granularity (use hour, 6h, day, week, or month)"
	}
	gb, ok := db.ParseGroupBy(q.Get("group_by"))
	if !ok {
		return db.QueryParams{}, "invalid group_by (use release, language, edition, or none)"
	}

	tzName := strings.TrimSpace(q.Get("tz"))
	if tzName == "" {
		tzName = "Europe/Zurich"
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		return db.QueryParams{}, fmt.Sprintf("invalid tz: %s", tzName)
	}

	now := time.Now().UTC()
	to := now
	if toRaw := strings.TrimSpace(q.Get("to")); toRaw != "" {
		parsed, err := parseFlexibleTime(toRaw, loc, true)
		if err != nil {
			return db.QueryParams{}, "invalid to timestamp"
		}
		to = parsed
	}

	from := defaultFrom(gran, to)
	if fromRaw := strings.TrimSpace(q.Get("from")); fromRaw != "" {
		parsed, err := parseFlexibleTime(fromRaw, loc, false)
		if err != nil {
			return db.QueryParams{}, "invalid from timestamp"
		}
		from = parsed
	} else if rangeRaw := strings.TrimSpace(q.Get("range")); rangeRaw != "" {
		if strings.EqualFold(rangeRaw, "all") {
			if first, _, err := store.PollHistoryBounds(r.Context()); err == nil && first != nil && !first.After(to) {
				from = *first
			} else {
				from = to.Add(-30 * 24 * time.Hour)
			}
		} else if d, ok := parseRangePreset(rangeRaw); ok {
			from = to.Add(-d)
		}
	}

	if to.Before(from) {
		return db.QueryParams{}, "to must be >= from"
	}

	var assetID int64
	if aid := strings.TrimSpace(q.Get("asset_id")); aid != "" {
		parsed, err := strconv.ParseInt(aid, 10, 64)
		if err != nil || parsed <= 0 {
			return db.QueryParams{}, "invalid asset_id"
		}
		assetID = parsed
	}

	var hourPtr *int
	if hRaw := strings.TrimSpace(q.Get("hour")); hRaw != "" {
		h, err := strconv.Atoi(hRaw)
		if err != nil || h < 0 || h > 23 {
			return db.QueryParams{}, "invalid hour (use 0..23)"
		}
		hourPtr = &h
	}
	var dowPtr *int
	if dRaw := strings.TrimSpace(q.Get("dow")); dRaw != "" {
		d, err := strconv.Atoi(dRaw)
		if err != nil || d < 1 || d > 7 {
			return db.QueryParams{}, "invalid dow (use 1..7)"
		}
		dowPtr = &d
	}

	return db.QueryParams{
		From:        from,
		To:          to,
		TZName:      tzName,
		Loc:         loc,
		Granularity: gran,
		GroupBy:     gb,
		Release:     strings.TrimSpace(q.Get("release")),
		Category:    strings.TrimSpace(q.Get("category")),
		Subject:     strings.TrimSpace(q.Get("subject")),
		Language:    strings.TrimSpace(q.Get("language")),
		Edition:     strings.TrimSpace(q.Get("edition")),
		Search:      strings.TrimSpace(q.Get("q")),
		AssetID:     assetID,
		ItemKey:     strings.TrimSpace(q.Get("item_key")),
		Hour:        hourPtr,
		DOW:         dowPtr,
	}, ""
}

func defaultFrom(gran db.Granularity, to time.Time) time.Time {
	switch gran {
	case db.GranularityHour:
		return to.Add(-48 * time.Hour)
	case db.Granularity6Hour:
		return to.Add(-7 * 24 * time.Hour)
	case db.GranularityWeek:
		return to.Add(-90 * 24 * time.Hour)
	case db.GranularityMonth:
		return to.Add(-365 * 24 * time.Hour)
	default:
		return to.Add(-30 * 24 * time.Hour)
	}
}

func parseRangePreset(s string) (time.Duration, bool) {
	switch strings.ToLower(s) {
	case "24h":
		return 24 * time.Hour, true
	case "48h":
		return 48 * time.Hour, true
	case "7d":
		return 7 * 24 * time.Hour, true
	case "30d":
		return 30 * 24 * time.Hour, true
	case "90d":
		return 90 * 24 * time.Hour, true
	case "365d", "1y":
		return 365 * 24 * time.Hour, true
	default:
		return 0, false
	}
}

func parseFlexibleTime(raw string, loc *time.Location, endOfDay bool) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC(), nil
	}
	if d, err := time.ParseInLocation("2006-01-02", raw, loc); err == nil {
		if endOfDay {
			return d.Add(24*time.Hour - time.Second).UTC(), nil
		}
		return d.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("unrecognized time %q", raw)
}

func writeTimeSeriesCSV(w http.ResponseWriter, ts db.TimeSeriesResponse) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="euler-downloads-%s.csv"`, ts.Granularity))
	cw := csv.NewWriter(w)

	header := []string{"timestamp", "label", "delta_downloads", "cumulative_downloads"}
	for _, k := range ts.SeriesKeys {
		header = append(header, "delta_"+k)
	}
	_ = cw.Write(header)

	for _, b := range ts.Buckets {
		cumStr := ""
		if b.Cumulative != nil {
			cumStr = strconv.FormatInt(*b.Cumulative, 10)
		}
		row := []string{
			b.Timestamp.Format(time.RFC3339),
			b.Label,
			strconv.FormatInt(b.Delta, 10),
			cumStr,
		}
		for _, k := range ts.SeriesKeys {
			row = append(row, strconv.FormatInt(b.Series[k], 10))
		}
		_ = cw.Write(row)
	}
	cw.Flush()
}

func writeAssetsCSV(w http.ResponseWriter, assets []db.AssetRow) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="euler-assets.csv"`)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"asset_id", "item_key", "release_tag", "asset_name", "display_title", "category", "subject",
		"language", "edition", "author", "size_bytes", "version_count",
		"current_version_downloads", "all_time_downloads",
		"window_delta", "last_24h_delta", "last_7d_delta", "share_pct", "is_active",
	})
	for _, a := range assets {
		_ = cw.Write([]string{
			strconv.FormatInt(a.AssetID, 10),
			a.ItemKey,
			a.ReleaseTag,
			a.AssetName,
			a.DisplayTitle,
			a.Category,
			a.Subject,
			a.Language,
			a.Edition,
			a.Author,
			strconv.FormatInt(a.SizeBytes, 10),
			strconv.Itoa(a.VersionCount),
			strconv.FormatInt(a.CurrentVersionDownloads, 10),
			strconv.FormatInt(a.AllTimeDownloads, 10),
			strconv.FormatInt(a.WindowDelta, 10),
			strconv.FormatInt(a.Last24hDelta, 10),
			strconv.FormatInt(a.Last7dDelta, 10),
			fmt.Sprintf("%.2f", a.SharePct),
			strconv.FormatBool(a.IsActive),
		})
	}
	cw.Flush()
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}

func jsonError(w http.ResponseWriter, msg string, status int) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func calendarDateInLoc(t time.Time, loc *time.Location) time.Time {
	lt := t.In(loc)
	return time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, time.UTC)
}

func parsePlayQueryParams(r *http.Request, store analyticsReader) (db.QueryParams, db.PlayFilter, string) {
	q := r.URL.Query()
	gran, ok := db.ParseGranularity(q.Get("granularity"))
	if !ok {
		return db.QueryParams{}, db.PlayFilter{}, "invalid granularity"
	}
	tzName := strings.TrimSpace(q.Get("tz"))
	if tzName == "" {
		tzName = "Europe/Zurich"
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		return db.QueryParams{}, db.PlayFilter{}, fmt.Sprintf("invalid tz: %s", tzName)
	}

	now := time.Now().UTC()
	to := now
	if toRaw := strings.TrimSpace(q.Get("to")); toRaw != "" {
		parsed, err := parseFlexibleTime(toRaw, loc, true)
		if err != nil {
			return db.QueryParams{}, db.PlayFilter{}, "invalid to timestamp"
		}
		to = parsed
	}

	from := to.Add(-30 * 24 * time.Hour)
	if gran == db.GranularityHour {
		from = to.Add(-7 * 24 * time.Hour)
	}
	if fromRaw := strings.TrimSpace(q.Get("from")); fromRaw != "" {
		parsed, err := parseFlexibleTime(fromRaw, loc, false)
		if err != nil {
			return db.QueryParams{}, db.PlayFilter{}, "invalid from timestamp"
		}
		from = parsed
	} else if rangeRaw := strings.TrimSpace(q.Get("range")); rangeRaw != "" {
		if strings.EqualFold(rangeRaw, "all") {
			if minD, _, err := store.PlayDateBounds(r.Context()); err == nil && minD != nil && !minD.After(to) {
				from = *minD
			} else {
				from = to.Add(-180 * 24 * time.Hour)
			}
		} else if d, ok := parseRangePreset(rangeRaw); ok {
			from = to.Add(-d)
		}
	}

	if to.Before(from) {
		return db.QueryParams{}, db.PlayFilter{}, "to must be >= from"
	}

	dimType, ok := db.ParsePlayDimType(q.Get("dim_type"))
	if !ok {
		return db.QueryParams{}, db.PlayFilter{}, "invalid dim_type"
	}
	dimVal := strings.TrimSpace(q.Get("dim_value"))
	if dimType == "" {
		if country := strings.TrimSpace(q.Get("country")); country != "" && !strings.EqualFold(country, "all") {
			dimType = "country"
			dimVal = country
		}
	}

	return db.QueryParams{
		From:        from,
		To:          to,
		TZName:      tzName,
		Loc:         loc,
		Granularity: gran,
	}, db.PlayFilter{DimType: dimType, DimValue: dimVal}, ""
}

func writePlayTimeSeriesCSV(w http.ResponseWriter, ts db.PlayTimeSeriesResponse) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="euler-play-%s.csv"`, ts.Granularity))
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"timestamp", "label", "device_installs", "device_uninstalls", "user_installs", "user_uninstalls",
		"active_devices", "install_events", "update_events", "store_visitors", "store_acquisitions",
		"conversion_rate_pct", "daily_avg_rating", "total_avg_rating", "crashes", "anrs", "distinct_users",
	})
	for _, p := range ts.Points {
		dRat, tRat := "", ""
		if p.DailyAvgRating != nil {
			dRat = fmt.Sprintf("%.2f", *p.DailyAvgRating)
		}
		if p.TotalAvgRating != nil {
			tRat = fmt.Sprintf("%.2f", *p.TotalAvgRating)
		}
		_ = cw.Write([]string{
			p.Timestamp.Format(time.RFC3339), p.Label,
			strconv.FormatInt(p.DeviceInstalls, 10), strconv.FormatInt(p.DeviceUninstalls, 10),
			strconv.FormatInt(p.UserInstalls, 10), strconv.FormatInt(p.UserUninstalls, 10),
			strconv.FormatInt(p.ActiveDevices, 10), strconv.FormatInt(p.InstallEvents, 10),
			strconv.FormatInt(p.UpdateEvents, 10), strconv.FormatInt(p.StoreVisitors, 10),
			strconv.FormatInt(p.StoreAcquisitions, 10), fmt.Sprintf("%.2f", p.ConversionRate),
			dRat, tRat, strconv.FormatInt(p.Crashes, 10), strconv.FormatInt(p.ANRs, 10),
			strconv.FormatInt(p.DistinctUsers, 10),
		})
	}
	cw.Flush()
}

func writePlayCountriesCSV(w http.ResponseWriter, rows []db.PlayDimensionRow) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="euler-play-countries.csv"`)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"country", "device_installs", "device_uninstalls", "user_installs", "active_devices",
		"store_visitors", "store_acquisitions", "conversion_rate_pct", "avg_rating", "crashes", "anrs",
	})
	for _, r := range rows {
		rat := ""
		if r.AvgRating != nil {
			rat = fmt.Sprintf("%.2f", *r.AvgRating)
		}
		_ = cw.Write([]string{
			r.DimensionValue,
			strconv.FormatInt(r.DeviceInstalls, 10), strconv.FormatInt(r.DeviceUninstalls, 10),
			strconv.FormatInt(r.UserInstalls, 10), strconv.FormatInt(r.ActiveDevices, 10),
			strconv.FormatInt(r.StoreVisitors, 10), strconv.FormatInt(r.StoreAcquisitions, 10),
			fmt.Sprintf("%.2f", r.ConversionRate), rat,
			strconv.FormatInt(r.Crashes, 10), strconv.FormatInt(r.ANRs, 10),
		})
	}
	cw.Flush()
}
