package db

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// NotificationSettings controls email alert behavior stored in Postgres.
type NotificationSettings struct {
	Enabled               bool      `json:"enabled"`
	RecipientEmail        string    `json:"recipient_email"`
	CrashAlertsEnabled    bool      `json:"crash_alerts_enabled"`
	CrashMinVersionCode   int64     `json:"crash_min_version_code"`
	IncludeANRs           bool      `json:"include_anrs"`
	CrashSince            time.Time `json:"crash_since"`
	DownloadAlertsEnabled bool      `json:"download_alerts_enabled"`
	MinDownloadDelta      int64     `json:"min_download_delta"`
	UpdatedAt             time.Time `json:"updated_at"`
}

// NotificationSettingsUpdate represents validated fields mutable via API/UI.
type NotificationSettingsUpdate struct {
	Enabled               bool   `json:"enabled"`
	RecipientEmail        string `json:"recipient_email"`
	CrashAlertsEnabled    bool   `json:"crash_alerts_enabled"`
	CrashMinVersionCode   int64  `json:"crash_min_version_code"`
	IncludeANRs           bool   `json:"include_anrs"`
	DownloadAlertsEnabled bool   `json:"download_alerts_enabled"`
	MinDownloadDelta      int64  `json:"min_download_delta"`
	ResetCrashBaseline    bool   `json:"reset_crash_baseline"`
}

// NotificationLogEntry records one sent, skipped, or failed email notification.
type NotificationLogEntry struct {
	ID           int64          `json:"id"`
	CreatedAt    time.Time      `json:"created_at"`
	EventType    string         `json:"event_type"`
	Recipient    string         `json:"recipient"`
	Subject      string         `json:"subject"`
	BodyText     string         `json:"body_text"`
	Status       string         `json:"status"`
	ErrorMessage string         `json:"error_message"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// CrashSignal represents a Play crash/ANR observation from hourly vitals or daily CSVs.
type CrashSignal struct {
	StateKey      string    `json:"state_key"`
	Source        string    `json:"source"` // "vitals_hourly" | "csv_daily"
	Period        string    `json:"period"` // "HOURLY" | "DAILY"
	BucketTime    time.Time `json:"bucket_time"`
	TimeLabel     string    `json:"time_label"`
	ReportType    string    `json:"report_type"` // "CRASH" | "ANR"
	VersionCode   int64     `json:"version_code"`
	Count         int64     `json:"count"`
	NewDelta      int64     `json:"new_delta"`
	DistinctUsers int64     `json:"distinct_users"`
}

// GetNotificationSettings loads singleton alert config, seeding defaultRecipient if row is missing.
func (s *Store) GetNotificationSettings(ctx context.Context, defaultRecipient string) (NotificationSettings, error) {
	if strings.TrimSpace(defaultRecipient) == "" {
		defaultRecipient = "ai.professor.euler@gmail.com"
	}
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO euler_stats.notification_settings (id, recipient_email)
		VALUES (1, $1)
		ON CONFLICT (id) DO NOTHING
	`, defaultRecipient)
	if err != nil {
		return NotificationSettings{}, fmt.Errorf("ensure notification_settings: %w", err)
	}

	var out NotificationSettings
	err = s.Pool.QueryRow(ctx, `
		SELECT
			enabled, recipient_email, crash_alerts_enabled, crash_min_version_code,
			include_anrs, crash_since, download_alerts_enabled, min_download_delta, updated_at
		FROM euler_stats.notification_settings
		WHERE id = 1
	`).Scan(
		&out.Enabled,
		&out.RecipientEmail,
		&out.CrashAlertsEnabled,
		&out.CrashMinVersionCode,
		&out.IncludeANRs,
		&out.CrashSince,
		&out.DownloadAlertsEnabled,
		&out.MinDownloadDelta,
		&out.UpdatedAt,
	)
	if err != nil {
		return NotificationSettings{}, fmt.Errorf("load notification_settings: %w", err)
	}
	return out, nil
}

// UpdateNotificationSettings validates and persists updated alert rules.
func (s *Store) UpdateNotificationSettings(ctx context.Context, upd NotificationSettingsUpdate) (NotificationSettings, error) {
	email := strings.TrimSpace(upd.RecipientEmail)
	if email == "" || !strings.Contains(email, "@") {
		return NotificationSettings{}, fmt.Errorf("invalid recipient_email")
	}
	if upd.CrashMinVersionCode < 0 {
		upd.CrashMinVersionCode = 0
	}
	if upd.MinDownloadDelta < 1 {
		upd.MinDownloadDelta = 1
	}

	query := `
		UPDATE euler_stats.notification_settings
		SET
			enabled                 = $1,
			recipient_email         = $2,
			crash_alerts_enabled    = $3,
			crash_min_version_code  = $4,
			include_anrs            = $5,
			download_alerts_enabled = $6,
			min_download_delta      = $7,
			updated_at              = now()
	`
	if upd.ResetCrashBaseline {
		query += `, crash_since = now()`
	}
	query += `
		WHERE id = 1
		RETURNING
			enabled, recipient_email, crash_alerts_enabled, crash_min_version_code,
			include_anrs, crash_since, download_alerts_enabled, min_download_delta, updated_at
	`

	var out NotificationSettings
	err := s.Pool.QueryRow(ctx, query,
		upd.Enabled, email, upd.CrashAlertsEnabled, upd.CrashMinVersionCode,
		upd.IncludeANRs, upd.DownloadAlertsEnabled, upd.MinDownloadDelta,
	).Scan(
		&out.Enabled,
		&out.RecipientEmail,
		&out.CrashAlertsEnabled,
		&out.CrashMinVersionCode,
		&out.IncludeANRs,
		&out.CrashSince,
		&out.DownloadAlertsEnabled,
		&out.MinDownloadDelta,
		&out.UpdatedAt,
	)
	if err != nil {
		return NotificationSettings{}, fmt.Errorf("update notification_settings: %w", err)
	}
	return out, nil
}

// GetCrashAlertStates returns previously notified crash counts keyed by state_key.
func (s *Store) GetCrashAlertStates(ctx context.Context) (map[string]int64, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT state_key, last_count
		FROM euler_stats.crash_alert_state
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]int64)
	for rows.Next() {
		var k string
		var cnt int64
		if err := rows.Scan(&k, &cnt); err != nil {
			return nil, err
		}
		out[k] = cnt
	}
	return out, rows.Err()
}

// UpsertCrashAlertStates persists notified crash counts cleanly so alerts are not repeated.
func (s *Store) UpsertCrashAlertStates(ctx context.Context, updates map[string]int64) error {
	if len(updates) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for k, v := range updates {
		batch.Queue(`
			INSERT INTO euler_stats.crash_alert_state (state_key, last_count, updated_at)
			VALUES ($1, $2, now())
			ON CONFLICT (state_key) DO UPDATE SET
				last_count = EXCLUDED.last_count,
				updated_at = now()
		`, k, v)
	}
	br := s.Pool.SendBatch(ctx, batch)
	for range updates {
		if _, err := br.Exec(); err != nil {
			_ = br.Close()
			return fmt.Errorf("upsert crash_alert_state: %w", err)
		}
	}
	return br.Close()
}

// InsertNotificationLog records a notification delivery attempt.
func (s *Store) InsertNotificationLog(ctx context.Context, e NotificationLogEntry) (int64, error) {
	metaBytes, _ := json.Marshal(e.Metadata)
	if len(metaBytes) == 0 {
		metaBytes = []byte("{}")
	}
	var id int64
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO euler_stats.notification_log (
			event_type, recipient, subject, body_text, status, error_message, metadata_json
		) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
		RETURNING id
	`, e.EventType, e.Recipient, e.Subject, e.BodyText, e.Status, e.ErrorMessage, string(metaBytes)).Scan(&id)
	return id, err
}

// GetNotificationLogs returns the newest notification attempts.
func (s *Store) GetNotificationLogs(ctx context.Context, limit int) ([]NotificationLogEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, created_at, event_type, recipient, subject, body_text, status, error_message, metadata_json::text
		FROM euler_stats.notification_log
		ORDER BY created_at DESC, id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []NotificationLogEntry{}
	for rows.Next() {
		var e NotificationLogEntry
		var rawMeta string
		if err := rows.Scan(
			&e.ID, &e.CreatedAt, &e.EventType, &e.Recipient,
			&e.Subject, &e.BodyText, &e.Status, &e.ErrorMessage, &rawMeta,
		); err != nil {
			return nil, err
		}
		if rawMeta != "" && rawMeta != "{}" {
			_ = json.Unmarshal([]byte(rawMeta), &e.Metadata)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetRecentCrashSignals inspects Play hourly vitals and daily crash CSVs from `since` onward,
// preferring per-version rows where available to avoid double counting.
func (s *Store) GetRecentCrashSignals(
	ctx context.Context,
	pkgName string,
	since time.Time,
	includeANRs bool,
	minVersionCode int64,
) ([]CrashSignal, []PlayTrackRow, error) {
	tracks, err := s.queryPlayTracks(ctx, pkgName)
	if err != nil {
		return nil, nil, err
	}

	var out []CrashSignal

	// 1. Hourly Play Reporting errorCountMetricSet
	type vitalRow struct {
		bucket time.Time
		dimKey string
		dimVal string
		cnt    int64
		users  int64
	}
	vRows, err := s.Pool.Query(ctx, `
		SELECT
			bucket_start,
			dimension_key,
			dimension_value,
			COALESCE((metrics_json->>'errorReportCount')::double precision, 0)::bigint,
			COALESCE((metrics_json->>'distinctUsers')::double precision, 0)::bigint
		FROM euler_stats.play_vitals_timeseries
		WHERE package_name = $1
		  AND metric_set = 'errorCountMetricSet'
		  AND aggregation_period = 'HOURLY'
		  AND bucket_start >= $2
		  AND COALESCE((metrics_json->>'errorReportCount')::double precision, 0) > 0
	`, pkgName, since)
	if err != nil {
		return nil, nil, fmt.Errorf("query crash vitals: %w", err)
	}
	var allVitals []vitalRow
	bucketsWithVersion := make(map[int64]bool)
	for vRows.Next() {
		var r vitalRow
		if err := vRows.Scan(&r.bucket, &r.dimKey, &r.dimVal, &r.cnt, &r.users); err != nil {
			vRows.Close()
			return nil, nil, err
		}
		allVitals = append(allVitals, r)
		if r.dimKey == "reportType,versionCode" {
			bucketsWithVersion[r.bucket.UTC().Unix()] = true
		}
	}
	vRows.Close()
	if err := vRows.Err(); err != nil {
		return nil, nil, err
	}

	for _, r := range allVitals {
		ep := r.bucket.UTC().Unix()
		if r.dimKey == "reportType,versionCode" {
			parts := strings.SplitN(r.dimVal, ",", 2)
			rType := strings.ToUpper(strings.TrimSpace(parts[0]))
			if rType == "ANR" && !includeANRs {
				continue
			}
			var vCode int64
			if len(parts) == 2 {
				vCode, _ = strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
			}
			if minVersionCode > 0 && vCode < minVersionCode {
				continue
			}
			out = append(out, CrashSignal{
				StateKey:      fmt.Sprintf("vitals:%s:%s:v%d", r.bucket.UTC().Format(time.RFC3339), rType, vCode),
				Source:        "vitals_hourly",
				Period:        "HOURLY",
				BucketTime:    r.bucket.UTC(),
				TimeLabel:     r.bucket.UTC().Format("2006-01-02 15:04 UTC"),
				ReportType:    rType,
				VersionCode:   vCode,
				Count:         r.cnt,
				DistinctUsers: r.users,
			})
		} else if r.dimKey == "reportType" && !bucketsWithVersion[ep] && minVersionCode == 0 {
			rType := strings.ToUpper(strings.TrimSpace(r.dimVal))
			if rType == "ANR" && !includeANRs {
				continue
			}
			out = append(out, CrashSignal{
				StateKey:      fmt.Sprintf("vitals:%s:%s:all", r.bucket.UTC().Format(time.RFC3339), rType),
				Source:        "vitals_hourly",
				Period:        "HOURLY",
				BucketTime:    r.bucket.UTC(),
				TimeLabel:     r.bucket.UTC().Format("2006-01-02 15:04 UTC"),
				ReportType:    rType,
				VersionCode:   0,
				Count:         r.cnt,
				DistinctUsers: r.users,
			})
		}
	}

	// 2. Daily Play Console CSVs (play_crashes_daily)
	sinceDate := since.UTC().Format("2006-01-02")
	type csvRow struct {
		date    time.Time
		dimType string
		dimVal  string
		crashes int64
		anrs    int64
	}
	cRows, err := s.Pool.Query(ctx, `
		SELECT report_date, dimension_type, dimension_value, daily_crashes, daily_anrs
		FROM euler_stats.play_crashes_daily
		WHERE package_name = $1
		  AND report_date >= $2::date
		  AND dimension_type IN ('app_version', 'overview')
		  AND (daily_crashes > 0 OR ($3 AND daily_anrs > 0))
	`, pkgName, sinceDate, includeANRs)
	if err != nil {
		return nil, nil, fmt.Errorf("query daily crash CSVs: %w", err)
	}
	var allCSV []csvRow
	datesWithVersion := make(map[string]bool)
	for cRows.Next() {
		var r csvRow
		if err := cRows.Scan(&r.date, &r.dimType, &r.dimVal, &r.crashes, &r.anrs); err != nil {
			cRows.Close()
			return nil, nil, err
		}
		allCSV = append(allCSV, r)
		if r.dimType == "app_version" {
			datesWithVersion[r.date.Format("2006-01-02")] = true
		}
	}
	cRows.Close()
	if err := cRows.Err(); err != nil {
		return nil, nil, err
	}

	for _, r := range allCSV {
		dateStr := r.date.Format("2006-01-02")
		var vCode int64
		if r.dimType == "app_version" {
			vCode, _ = strconv.ParseInt(strings.TrimSpace(r.dimVal), 10, 64)
			if minVersionCode > 0 && vCode < minVersionCode {
				continue
			}
		} else if datesWithVersion[dateStr] || minVersionCode > 0 {
			continue
		}

		if r.crashes > 0 {
			out = append(out, CrashSignal{
				StateKey:    fmt.Sprintf("csv:%s:CRASH:v%d", dateStr, vCode),
				Source:      "csv_daily",
				Period:      "DAILY",
				BucketTime:  r.date.UTC(),
				TimeLabel:   dateStr,
				ReportType:  "CRASH",
				VersionCode: vCode,
				Count:       r.crashes,
			})
		}
		if includeANRs && r.anrs > 0 {
			out = append(out, CrashSignal{
				StateKey:    fmt.Sprintf("csv:%s:ANR:v%d", dateStr, vCode),
				Source:      "csv_daily",
				Period:      "DAILY",
				BucketTime:  r.date.UTC(),
				TimeLabel:   dateStr,
				ReportType:  "ANR",
				VersionCode: vCode,
				Count:       r.anrs,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		if !out[i].BucketTime.Equal(out[j].BucketTime) {
			return out[i].BucketTime.After(out[j].BucketTime)
		}
		return out[i].StateKey < out[j].StateKey
	})
	return out, tracks, nil
}
