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
	"github.com/dawei7/dawei7/apps/euler-stats/poller"
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
}

type pollRunner interface {
	PollOnce(ctx context.Context) (poller.PollResult, error)
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
	ghClient := github.NewClient(os.Getenv("GITHUB_TOKEN"))
	collector := poller.New(ghClient, store)

	go collector.RunScheduler(rootCtx)

	adminSecret := os.Getenv("ADMIN_SECRET")
	mux := newMux(store, collector, adminSecret)

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

func newMux(store analyticsReader, collector pollRunner, adminSecret string) *http.ServeMux {
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
		if adminSecret == "" {
			jsonError(w, "manual poll endpoint disabled (ADMIN_SECRET not set)", http.StatusForbidden)
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(token), []byte(adminSecret)) != 1 {
			jsonError(w, "unauthorized", http.StatusUnauthorized)
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

	// Embedded React SPA
	sub, err := fs.Sub(staticFiles, "frontend/dist")
	if err != nil {
		log.Fatalf("embed sub: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			jsonError(w, "not found", http.StatusNotFound)
			return
		}
		clean := strings.TrimPrefix(r.URL.Path, "/")
		if clean == "" {
			clean = "index.html"
		}
		if strings.HasPrefix(clean, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if _, err := fs.Stat(sub, clean); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			w.Header().Set("Cache-Control", "no-cache")
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	return mux
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
