package notify

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"github.com/dawei7/dawei7/apps/euler-stats/poller"
)

// Store defines the persistence operations used by the notification service.
type Store interface {
	GetNotificationSettings(ctx context.Context, defaultRecipient string) (db.NotificationSettings, error)
	UpdateNotificationSettings(ctx context.Context, upd db.NotificationSettingsUpdate) (db.NotificationSettings, error)
	GetCrashAlertStates(ctx context.Context) (map[string]int64, error)
	UpsertCrashAlertStates(ctx context.Context, updates map[string]int64) error
	InsertNotificationLog(ctx context.Context, entry db.NotificationLogEntry) (int64, error)
	GetNotificationLogs(ctx context.Context, limit int) ([]db.NotificationLogEntry, error)
	GetRecentCrashSignals(ctx context.Context, pkgName string, since time.Time, includeANRs bool, minVersionCode int64) ([]db.CrashSignal, []db.PlayTrackRow, error)
}

// NotificationStatusResponse bundles config, SMTP state, and recent alert logs for the UI.
type NotificationStatusResponse struct {
	Settings       db.NotificationSettings   `json:"settings"`
	SMTP           SMTPStatus                `json:"smtp"`
	AdminProtected bool                      `json:"admin_protected"`
	Logs           []db.NotificationLogEntry `json:"logs"`
}

// Service evaluates asset download deltas and post-update Play crashes and dispatches emails.
type Service struct {
	store        Store
	sender       Sender
	packageName  string
	dashboardURL string
	loc          *time.Location
	mu           sync.Mutex
}

// NewService constructs a Notification Service backed by Postgres and an email Sender.
func NewService(store Store, sender Sender, packageName, dashboardURL string) *Service {
	loc, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		loc = time.UTC
	}
	if strings.TrimSpace(dashboardURL) == "" {
		dashboardURL = "https://euler-stats.dawei7.com"
	}
	return &Service{
		store:        store,
		sender:       sender,
		packageName:  packageName,
		dashboardURL: strings.TrimRight(dashboardURL, "/"),
		loc:          loc,
	}
}

// GetOverview loads settings, SMTP readiness, and recent notification logs.
func (s *Service) GetOverview(ctx context.Context, limit int, adminProtected bool) (NotificationStatusResponse, error) {
	settings, err := s.store.GetNotificationSettings(ctx, s.sender.Status().DefaultDest)
	if err != nil {
		return NotificationStatusResponse{}, err
	}
	logs, err := s.store.GetNotificationLogs(ctx, limit)
	if err != nil {
		return NotificationStatusResponse{}, err
	}
	return NotificationStatusResponse{
		Settings:       settings,
		SMTP:           s.sender.Status(),
		AdminProtected: adminProtected,
		Logs:           logs,
	}, nil
}

// UpdateSettings validates and updates mutable alert configuration.
func (s *Service) UpdateSettings(ctx context.Context, upd db.NotificationSettingsUpdate) (db.NotificationSettings, error) {
	// Ensure singleton row exists first.
	if _, err := s.store.GetNotificationSettings(ctx, s.sender.Status().DefaultDest); err != nil {
		return db.NotificationSettings{}, err
	}
	return s.store.UpdateNotificationSettings(ctx, upd)
}

// CheckAndNotifyDownloads inspects a completed GitHub poll and emails when asset downloads changed.
func (s *Service) CheckAndNotifyDownloads(ctx context.Context, res poller.PollResult) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if res.IsBaseline || res.TotalDelta <= 0 || len(res.ChangedAssets) == 0 {
		return
	}

	settings, err := s.store.GetNotificationSettings(ctx, s.sender.Status().DefaultDest)
	if err != nil {
		log.Printf("notify downloads: load settings error: %v", err)
		return
	}
	if !settings.Enabled || !settings.DownloadAlertsEnabled || res.TotalDelta < settings.MinDownloadDelta {
		return
	}

	ts := res.PolledAt
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	subject := fmt.Sprintf("[Euler Stats] +%d asset download(s) (Total: %d)", res.TotalDelta, res.TotalDownloads)
	textBody, htmlBody := formatDownloadsEmail(res, ts, s.loc, s.dashboardURL)

	meta := map[string]any{
		"poll_run_id":     res.PollRunID,
		"total_delta":     res.TotalDelta,
		"total_downloads": res.TotalDownloads,
		"changed_count":   len(res.ChangedAssets),
		"changed_assets":  res.ChangedAssets,
	}
	s.dispatchAndLog(ctx, "asset_downloads", settings.RecipientEmail, subject, textBody, htmlBody, meta)
}

// CheckAndNotifyPlayCrashes inspects Play Reporting hourly vitals and daily crash CSVs
// and sends an email whenever newly detected post-update crashes increase.
func (s *Service) CheckAndNotifyPlayCrashes(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()

	settings, err := s.store.GetNotificationSettings(ctx, s.sender.Status().DefaultDest)
	if err != nil {
		log.Printf("notify crashes: load settings error: %v", err)
		return
	}
	if !settings.Enabled || !settings.CrashAlertsEnabled {
		return
	}

	signals, tracks, err := s.store.GetRecentCrashSignals(
		ctx,
		s.packageName,
		settings.CrashSince,
		settings.IncludeANRs,
		settings.CrashMinVersionCode,
	)
	if err != nil {
		log.Printf("notify crashes: query signals error: %v", err)
		return
	}
	if len(signals) == 0 {
		return
	}

	prevStates, err := s.store.GetCrashAlertStates(ctx)
	if err != nil {
		log.Printf("notify crashes: load crash state error: %v", err)
		return
	}

	var newSignals []db.CrashSignal
	stateUpdates := make(map[string]int64)
	var totalNewDelta int64

	for _, sig := range signals {
		prev := prevStates[sig.StateKey]
		if sig.Count <= prev {
			continue
		}
		sig.NewDelta = sig.Count - prev
		totalNewDelta += sig.NewDelta
		newSignals = append(newSignals, sig)
		stateUpdates[sig.StateKey] = sig.Count
	}

	if len(newSignals) == 0 {
		return
	}

	prodLabel := productionReleaseLabel(tracks)
	subject := fmt.Sprintf("[Euler Stats] Google Play Crash Alert: +%d new (%s)", totalNewDelta, prodLabel)
	textBody, htmlBody := formatCrashesEmail(s.packageName, totalNewDelta, newSignals, tracks, s.loc, s.dashboardURL)

	meta := map[string]any{
		"package_name":    s.packageName,
		"total_new_delta": totalNewDelta,
		"signals":         newSignals,
	}
	status := s.dispatchAndLog(ctx, "play_crash", settings.RecipientEmail, subject, textBody, htmlBody, meta)
	if status == "sent" || status == "skipped" {
		if err := s.store.UpsertCrashAlertStates(ctx, stateUpdates); err != nil {
			log.Printf("notify crashes: save crash state error: %v", err)
		}
	}
}

// SendTest sends an immediate verification email to verify Gmail SMTP credentials end-to-end.
func (s *Service) SendTest(ctx context.Context) (db.NotificationLogEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	settings, err := s.store.GetNotificationSettings(ctx, s.sender.Status().DefaultDest)
	if err != nil {
		return db.NotificationLogEntry{}, err
	}

	now := time.Now().UTC()
	subject := "[Euler Stats] Test Notification (Gmail SMTP Active)"
	textBody := fmt.Sprintf(
		"Professor Euler Notification Service test\n"+
			"Time (%s): %s\n"+
			"Recipient: %s\n"+
			"Play Crash Alerts: %v (since %s, min versionCode: %d, include ANRs: %v)\n"+
			"Asset Download Delta Alerts: %v (min delta: %d)\n\n"+
			"Dashboard: %s\n",
		s.loc.String(),
		now.In(s.loc).Format("2006-01-02 15:04:05 MST"),
		settings.RecipientEmail,
		settings.CrashAlertsEnabled,
		settings.CrashSince.In(s.loc).Format("2006-01-02 15:04"),
		settings.CrashMinVersionCode,
		settings.IncludeANRs,
		settings.DownloadAlertsEnabled,
		settings.MinDownloadDelta,
		s.dashboardURL,
	)
	htmlBody := fmt.Sprintf(
		`<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;background:#faf7f1;color:#1c1914;border:1px solid #d5cdb8;border-radius:12px;">
			<h2 style="margin:0 0 8px;color:#1e4636;">Professor Euler · Test Notification</h2>
			<p style="font-family:sans-serif;font-size:14px;color:#4a4338;">Your Gmail SMTP notification pipeline is active.</p>
			<div style="font-family:sans-serif;font-size:13px;background:#fffcf6;border:1px solid #e7e0d2;border-radius:8px;padding:12px 14px;line-height:1.6;">
				<div><strong>Time:</strong> %s</div>
				<div><strong>Recipient:</strong> %s</div>
				<div><strong>Play Crash Alerts:</strong> %v (since %s)</div>
				<div><strong>Asset Download Alerts:</strong> %v (delta &ge; %d)</div>
			</div>
			<p style="font-family:sans-serif;font-size:13px;margin-top:16px;"><a href="%s" style="color:#1e4636;">Open Dashboard &rarr;</a></p>
		</div>`,
		html.EscapeString(now.In(s.loc).Format("2006-01-02 15:04:05 MST")),
		html.EscapeString(settings.RecipientEmail),
		settings.CrashAlertsEnabled,
		html.EscapeString(settings.CrashSince.In(s.loc).Format("2006-01-02 15:04")),
		settings.DownloadAlertsEnabled,
		settings.MinDownloadDelta,
		html.EscapeString(s.dashboardURL),
	)

	sendErr := s.sender.Send(ctx, settings.RecipientEmail, subject, textBody, htmlBody)
	entry := db.NotificationLogEntry{
		CreatedAt: now,
		EventType: "test",
		Recipient: settings.RecipientEmail,
		Subject:   subject,
		BodyText:  textBody,
		Status:    "sent",
	}
	if errors.Is(sendErr, ErrNotConfigured) {
		entry.Status = "skipped"
		entry.ErrorMessage = sendErr.Error()
	} else if sendErr != nil {
		entry.Status = "error"
		entry.ErrorMessage = sendErr.Error()
	}
	id, logErr := s.store.InsertNotificationLog(ctx, entry)
	if logErr == nil {
		entry.ID = id
	}
	return entry, sendErr
}

func (s *Service) dispatchAndLog(
	ctx context.Context,
	eventType, recipient, subject, textBody, htmlBody string,
	meta map[string]any,
) string {
	sendErr := s.sender.Send(ctx, recipient, subject, textBody, htmlBody)
	status := "sent"
	errMsg := ""
	if errors.Is(sendErr, ErrNotConfigured) {
		status = "skipped"
		errMsg = sendErr.Error()
		log.Printf("[notify:%s] skipped (%s): %s", eventType, errMsg, subject)
	} else if sendErr != nil {
		status = "error"
		errMsg = sendErr.Error()
		log.Printf("[notify:%s] failed sending to %s: %v", eventType, recipient, sendErr)
	} else {
		log.Printf("[notify:%s] email sent to %s: %s", eventType, recipient, subject)
	}

	if _, err := s.store.InsertNotificationLog(ctx, db.NotificationLogEntry{
		EventType:    eventType,
		Recipient:    recipient,
		Subject:      subject,
		BodyText:     textBody,
		Status:       status,
		ErrorMessage: errMsg,
		Metadata:     meta,
	}); err != nil {
		log.Printf("[notify:%s] log insert error: %v", eventType, err)
	}
	return status
}

func productionReleaseLabel(tracks []db.PlayTrackRow) string {
	for _, t := range tracks {
		if t.TrackName == "production" && t.ReleaseName != "" {
			if t.VersionCodes != "" {
				return fmt.Sprintf("Prod v%s / code %s", t.ReleaseName, t.VersionCodes)
			}
			return fmt.Sprintf("Prod v%s", t.ReleaseName)
		}
	}
	return "com.mathn.tablet"
}

func formatDownloadsEmail(
	res poller.PollResult,
	ts time.Time,
	loc *time.Location,
	dashboardURL string,
) (string, string) {
	timeStr := fmt.Sprintf("%s (%s)", ts.In(loc).Format("2006-01-02 15:04 MST"), ts.UTC().Format("15:04 UTC"))

	var tb strings.Builder
	fmt.Fprintf(&tb, "Professor Euler Asset Download Change Report\n")
	fmt.Fprintf(&tb, "Poll #%d · %s\n\n", res.PollRunID, timeStr)
	fmt.Fprintf(&tb, "Total new downloads (delta): +%d\n", res.TotalDelta)
	fmt.Fprintf(&tb, "Current GitHub releases total: %d downloads across %d assets\n\n", res.TotalDownloads, res.AssetsCount)
	fmt.Fprintf(&tb, "Changed Assets (%d):\n", len(res.ChangedAssets))
	for _, a := range res.ChangedAssets {
		title := a.DisplayTitle
		if title == "" {
			title = a.AssetName
		}
		fmt.Fprintf(&tb, "- %s [%s · %s/%s] +%d (%d -> %d)\n  file: %s\n",
			title, a.ReleaseTag, a.Language, a.Edition, a.Delta, a.PrevCount, a.CurrentCount, a.AssetName)
	}
	fmt.Fprintf(&tb, "\nView dashboard: %s\n", dashboardURL)

	var hb strings.Builder
	fmt.Fprintf(&hb, `<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;padding:20px;background:#faf7f1;color:#1c1914;border:1px solid #d5cdb8;border-radius:12px;">`)
	fmt.Fprintf(&hb, `<h2 style="margin:0 0 6px;color:#1e4636;">+%d New Asset Download(s)</h2>`, res.TotalDelta)
	fmt.Fprintf(&hb, `<p style="font-family:sans-serif;font-size:13px;color:#6e6558;margin:0 0 14px;">Poll #%d &middot; %s &middot; Total: <strong>%d</strong></p>`,
		res.PollRunID, html.EscapeString(timeStr), res.TotalDownloads)
	fmt.Fprintf(&hb, `<table style="width:100%%;border-collapse:collapse;font-family:sans-serif;font-size:13px;background:#fffcf6;border:1px solid #e7e0d2;border-radius:8px;">`)
	fmt.Fprintf(&hb, `<thead><tr style="background:#f3eee4;text-align:left;font-size:11px;text-transform:uppercase;color:#6e6558;">`+
		`<th style="padding:8px 10px;">Asset / Workbook</th><th style="padding:8px 10px;">Release</th>`+
		`<th style="padding:8px 10px;text-align:right;">Delta</th><th style="padding:8px 10px;text-align:right;">Count</th></tr></thead><tbody>`)
	for _, a := range res.ChangedAssets {
		title := a.DisplayTitle
		if title == "" {
			title = a.AssetName
		}
		fmt.Fprintf(&hb, `<tr style="border-top:1px solid #ece5d7;">`+
			`<td style="padding:8px 10px;"><strong>%s</strong><div style="font-size:11px;color:#6e6558;font-family:monospace;">%s</div></td>`+
			`<td style="padding:8px 10px;color:#4a4338;">%s &middot; %s/%s</td>`+
			`<td style="padding:8px 10px;text-align:right;font-weight:700;color:#1e4636;">+%d</td>`+
			`<td style="padding:8px 10px;text-align:right;color:#4a4338;">%d &rarr; %d</td></tr>`,
			html.EscapeString(title), html.EscapeString(a.AssetName),
			html.EscapeString(a.ReleaseTag), html.EscapeString(a.Language), html.EscapeString(a.Edition),
			a.Delta, a.PrevCount, a.CurrentCount)
	}
	fmt.Fprintf(&hb, `</tbody></table>`)
	fmt.Fprintf(&hb, `<p style="font-family:sans-serif;font-size:13px;margin:16px 0 0;"><a href="%s" style="color:#1e4636;">Open Statistics Dashboard &rarr;</a></p></div>`,
		html.EscapeString(dashboardURL))

	return tb.String(), hb.String()
}

func formatCrashesEmail(
	pkgName string,
	totalNewDelta int64,
	signals []db.CrashSignal,
	tracks []db.PlayTrackRow,
	loc *time.Location,
	dashboardURL string,
) (string, string) {
	nowStr := time.Now().In(loc).Format("2006-01-02 15:04 MST")

	var tb strings.Builder
	fmt.Fprintf(&tb, "Google Play Crash Alert for %s\n", pkgName)
	fmt.Fprintf(&tb, "Detected at: %s\n", nowStr)
	fmt.Fprintf(&tb, "Production release: %s\n", productionReleaseLabel(tracks))
	fmt.Fprintf(&tb, "Newly reported crash/ANR delta: +%d\n\n", totalNewDelta)
	for _, sig := range signals {
		ver := "all versions"
		if sig.VersionCode > 0 {
			ver = fmt.Sprintf("versionCode %d", sig.VersionCode)
		}
		fmt.Fprintf(&tb, "- [%s · %s] %s (%s): +%d new (bucket total: %d, users: %d)\n",
			sig.Source, sig.TimeLabel, sig.ReportType, ver, sig.NewDelta, sig.Count, sig.DistinctUsers)
	}
	fmt.Fprintf(&tb, "\nOpen Google Play dashboard: %s\n", dashboardURL)

	var hb strings.Builder
	fmt.Fprintf(&hb, `<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;padding:20px;background:#faf7f1;color:#1c1914;border:1px solid #d5cdb8;border-radius:12px;">`)
	fmt.Fprintf(&hb, `<h2 style="margin:0 0 6px;color:#a4513a;">Google Play Crash Alert (+%d new)</h2>`, totalNewDelta)
	fmt.Fprintf(&hb, `<p style="font-family:sans-serif;font-size:13px;color:#4a4338;margin:0 0 14px;">Package: <code>%s</code> &middot; %s &middot; %s</p>`,
		html.EscapeString(pkgName), html.EscapeString(productionReleaseLabel(tracks)), html.EscapeString(nowStr))
	fmt.Fprintf(&hb, `<table style="width:100%%;border-collapse:collapse;font-family:sans-serif;font-size:13px;background:#fffcf6;border:1px solid #e7e0d2;">`)
	fmt.Fprintf(&hb, `<thead><tr style="background:#f3eee4;text-align:left;font-size:11px;text-transform:uppercase;color:#6e6558;">`+
		`<th style="padding:8px 10px;">Source / Time</th><th style="padding:8px 10px;">Type / Version</th>`+
		`<th style="padding:8px 10px;text-align:right;">New</th><th style="padding:8px 10px;text-align:right;">Bucket Total</th></tr></thead><tbody>`)
	for _, sig := range signals {
		ver := "all"
		if sig.VersionCode > 0 {
			ver = fmt.Sprintf("vCode %d", sig.VersionCode)
		}
		fmt.Fprintf(&hb, `<tr style="border-top:1px solid #ece5d7;">`+
			`<td style="padding:8px 10px;"><strong>%s</strong><div style="font-size:11px;color:#6e6558;">%s</div></td>`+
			`<td style="padding:8px 10px;">%s &middot; <strong>%s</strong></td>`+
			`<td style="padding:8px 10px;text-align:right;font-weight:700;color:#a4513a;">+%d</td>`+
			`<td style="padding:8px 10px;text-align:right;color:#4a4338;">%d (%d users)</td></tr>`,
			html.EscapeString(sig.TimeLabel), html.EscapeString(sig.Source),
			html.EscapeString(sig.ReportType), html.EscapeString(ver),
			sig.NewDelta, sig.Count, sig.DistinctUsers)
	}
	fmt.Fprintf(&hb, `</tbody></table>`)
	fmt.Fprintf(&hb, `<p style="font-family:sans-serif;font-size:13px;margin:16px 0 0;"><a href="%s" style="color:#1e4636;">Inspect on Dashboard &rarr;</a></p></div>`,
		html.EscapeString(dashboardURL))

	return tb.String(), hb.String()
}
