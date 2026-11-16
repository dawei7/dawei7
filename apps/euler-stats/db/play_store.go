package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const playAdvisoryLockID int64 = 884729105

// PlaySyncFile tracks GCS object state so unchanged CSV files are not re-downloaded.
type PlaySyncFile struct {
	ObjectName      string
	ETag            string
	MD5Hash         string
	Generation      int64
	SizeBytes       int64
	ObjectUpdatedAt *time.Time
	SyncedAt        time.Time
	RowsUpserted    int
}

// PlayInstallRow corresponds to one row from stats/installs/*.csv.
type PlayInstallRow struct {
	ReportDate            time.Time
	PackageName           string
	DimensionType         string
	DimensionValue        string
	DailyDeviceInstalls   int64
	DailyDeviceUninstalls int64
	DailyDeviceUpgrades   int64
	TotalUserInstalls     int64
	DailyUserInstalls     int64
	DailyUserUninstalls   int64
	ActiveDeviceInstalls  int64
	InstallEvents         int64
	UpdateEvents          int64
	UninstallEvents       int64
}

// PlayStorePerfRow corresponds to one row from stats/store_performance/*.csv.
type PlayStorePerfRow struct {
	ReportDate     time.Time
	PackageName    string
	DimensionType  string
	DimensionValue string
	SearchTerm     string
	UTMSource      string
	UTMCampaign    string
	Acquisitions   int64
	Visitors       int64
	ConversionRate float64
}

// PlayRatingRow corresponds to one row from stats/ratings/*.csv.
type PlayRatingRow struct {
	ReportDate     time.Time
	PackageName    string
	DimensionType  string
	DimensionValue string
	DailyAvgRating *float64
	TotalAvgRating *float64
}

// PlayCrashRow corresponds to one row from stats/crashes/*.csv.
type PlayCrashRow struct {
	ReportDate     time.Time
	PackageName    string
	DimensionType  string
	DimensionValue string
	DailyCrashes   int64
	DailyANRs      int64
}

// PlayReviewRow corresponds to one row from reviews/*.csv.
type PlayReviewRow struct {
	PackageName      string
	ReviewKey        string
	AppVersionCode   string
	AppVersionName   string
	ReviewerLanguage string
	Device           string
	SubmittedAt      time.Time
	UpdatedAt        time.Time
	StarRating       int
	ReviewTitle      string
	ReviewText       string
	ReplyAt          *time.Time
	ReplyText        string
	ReviewLink       string
}

// PlayVitalsRow corresponds to one bucket from Play Developer Reporting API.
type PlayVitalsRow struct {
	PackageName       string
	MetricSet         string
	AggregationPeriod string
	BucketStart       time.Time
	DimensionKey      string
	DimensionValue    string
	MetricsJSON       []byte
}

// PlayTrackRow represents an active Play Console release track.
type PlayTrackRow struct {
	PackageName  string    `json:"package_name"`
	TrackName    string    `json:"track_name"`
	ReleaseName  string    `json:"release_name"`
	Status       string    `json:"status"`
	VersionCodes string    `json:"version_codes"`
	ReleaseNotes string    `json:"release_notes"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PlayPollRunInput captures telemetry for a single Play Store sync execution.
type PlayPollRunInput struct {
	PolledAt             time.Time
	DurationMs           int
	Status               string
	ErrorMessage         string
	GCSObjectsSeen       int
	GCSObjectsDownloaded int
	GCSRowsUpserted      int
	VitalsRowsUpserted   int
	ReviewsUpserted      int
}

// PlaySyncBatch bundles all upserts for one atomic Play Store sync transaction.
type PlaySyncBatch struct {
	Files            []PlaySyncFile
	Installs         []PlayInstallRow
	StorePerformance []PlayStorePerfRow
	Ratings          []PlayRatingRow
	Crashes          []PlayCrashRow
	Reviews          []PlayReviewRow
	Vitals           []PlayVitalsRow
	Tracks           []PlayTrackRow
}

// TryPlayAdvisoryLock acquires a session-level advisory lock for Play Store syncs.
func (s *Store) TryPlayAdvisoryLock(ctx context.Context) (func(), bool, error) {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}
	var acquired bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, playAdvisoryLockID).Scan(&acquired); err != nil {
		conn.Release()
		return nil, false, err
	}
	if !acquired {
		conn.Release()
		return nil, false, nil
	}
	unlock := func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = conn.Exec(unlockCtx, `SELECT pg_advisory_unlock($1)`, playAdvisoryLockID)
		conn.Release()
	}
	return unlock, true, nil
}

// PlayLastSuccessfulPoll returns the latest successful Play Store sync timestamp, if any.
func (s *Store) PlayLastSuccessfulPoll(ctx context.Context) (*time.Time, error) {
	var last *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT MAX(polled_at)
		FROM euler_stats.play_poll_runs
		WHERE status = 'ok'
	`).Scan(&last)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return last, nil
}

// GetPlaySyncedFiles returns tracked GCS object metadata keyed by object_name.
func (s *Store) GetPlaySyncedFiles(ctx context.Context) (map[string]PlaySyncFile, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT object_name, etag, md5_hash, generation, size_bytes, object_updated_at, synced_at, rows_upserted
		FROM euler_stats.play_sync_files
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]PlaySyncFile)
	for rows.Next() {
		var f PlaySyncFile
		if err := rows.Scan(
			&f.ObjectName, &f.ETag, &f.MD5Hash, &f.Generation,
			&f.SizeBytes, &f.ObjectUpdatedAt, &f.SyncedAt, &f.RowsUpserted,
		); err != nil {
			return nil, err
		}
		out[f.ObjectName] = f
	}
	return out, rows.Err()
}

// SavePlaySync atomically upserts Play Store reports, vitals, reviews, tracks, and the poll audit log.
func (s *Store) SavePlaySync(ctx context.Context, run PlayPollRunInput, b PlaySyncBatch) (int64, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	runBatch := func(batch *pgx.Batch, count int, label string) error {
		if count == 0 {
			return nil
		}
		br := tx.SendBatch(ctx, batch)
		for i := 0; i < count; i++ {
			if _, err := br.Exec(); err != nil {
				_ = br.Close()
				return fmt.Errorf("%s upsert #%d: %w", label, i, err)
			}
		}
		return br.Close()
	}

	if len(b.Installs) > 0 {
		batch := &pgx.Batch{}
		for _, r := range b.Installs {
			batch.Queue(`
				INSERT INTO euler_stats.play_installs_daily (
					report_date, package_name, dimension_type, dimension_value,
					daily_device_installs, daily_device_uninstalls, daily_device_upgrades,
					total_user_installs, daily_user_installs, daily_user_uninstalls,
					active_device_installs, install_events, update_events, uninstall_events
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
				ON CONFLICT (report_date, package_name, dimension_type, dimension_value) DO UPDATE SET
					daily_device_installs   = EXCLUDED.daily_device_installs,
					daily_device_uninstalls = EXCLUDED.daily_device_uninstalls,
					daily_device_upgrades   = EXCLUDED.daily_device_upgrades,
					total_user_installs     = EXCLUDED.total_user_installs,
					daily_user_installs     = EXCLUDED.daily_user_installs,
					daily_user_uninstalls   = EXCLUDED.daily_user_uninstalls,
					active_device_installs  = EXCLUDED.active_device_installs,
					install_events          = EXCLUDED.install_events,
					update_events           = EXCLUDED.update_events,
					uninstall_events        = EXCLUDED.uninstall_events
			`, r.ReportDate, r.PackageName, r.DimensionType, r.DimensionValue,
				r.DailyDeviceInstalls, r.DailyDeviceUninstalls, r.DailyDeviceUpgrades,
				r.TotalUserInstalls, r.DailyUserInstalls, r.DailyUserUninstalls,
				r.ActiveDeviceInstalls, r.InstallEvents, r.UpdateEvents, r.UninstallEvents)
		}
		if err := runBatch(batch, len(b.Installs), "play_installs_daily"); err != nil {
			return 0, err
		}
	}

	if len(b.StorePerformance) > 0 {
		batch := &pgx.Batch{}
		for _, r := range b.StorePerformance {
			batch.Queue(`
				INSERT INTO euler_stats.play_store_performance_daily (
					report_date, package_name, dimension_type, dimension_value,
					search_term, utm_source, utm_campaign,
					acquisitions, visitors, conversion_rate
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
				ON CONFLICT (report_date, package_name, dimension_type, dimension_value, search_term, utm_source, utm_campaign)
				DO UPDATE SET
					acquisitions    = EXCLUDED.acquisitions,
					visitors        = EXCLUDED.visitors,
					conversion_rate = EXCLUDED.conversion_rate
			`, r.ReportDate, r.PackageName, r.DimensionType, r.DimensionValue,
				r.SearchTerm, r.UTMSource, r.UTMCampaign,
				r.Acquisitions, r.Visitors, r.ConversionRate)
		}
		if err := runBatch(batch, len(b.StorePerformance), "play_store_performance_daily"); err != nil {
			return 0, err
		}
	}

	if len(b.Ratings) > 0 {
		batch := &pgx.Batch{}
		for _, r := range b.Ratings {
			batch.Queue(`
				INSERT INTO euler_stats.play_ratings_daily (
					report_date, package_name, dimension_type, dimension_value,
					daily_avg_rating, total_avg_rating
				) VALUES ($1,$2,$3,$4,$5,$6)
				ON CONFLICT (report_date, package_name, dimension_type, dimension_value) DO UPDATE SET
					daily_avg_rating = EXCLUDED.daily_avg_rating,
					total_avg_rating = EXCLUDED.total_avg_rating
			`, r.ReportDate, r.PackageName, r.DimensionType, r.DimensionValue, r.DailyAvgRating, r.TotalAvgRating)
		}
		if err := runBatch(batch, len(b.Ratings), "play_ratings_daily"); err != nil {
			return 0, err
		}
	}

	if len(b.Crashes) > 0 {
		batch := &pgx.Batch{}
		for _, r := range b.Crashes {
			batch.Queue(`
				INSERT INTO euler_stats.play_crashes_daily (
					report_date, package_name, dimension_type, dimension_value,
					daily_crashes, daily_anrs
				) VALUES ($1,$2,$3,$4,$5,$6)
				ON CONFLICT (report_date, package_name, dimension_type, dimension_value) DO UPDATE SET
					daily_crashes = EXCLUDED.daily_crashes,
					daily_anrs    = EXCLUDED.daily_anrs
			`, r.ReportDate, r.PackageName, r.DimensionType, r.DimensionValue, r.DailyCrashes, r.DailyANRs)
		}
		if err := runBatch(batch, len(b.Crashes), "play_crashes_daily"); err != nil {
			return 0, err
		}
	}

	if len(b.Reviews) > 0 {
		batch := &pgx.Batch{}
		for _, r := range b.Reviews {
			batch.Queue(`
				INSERT INTO euler_stats.play_reviews (
					package_name, review_key, app_version_code, app_version_name,
					reviewer_language, device, submitted_at, updated_at, star_rating,
					review_title, review_text, reply_at, reply_text, review_link
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
				ON CONFLICT (package_name, review_key) DO UPDATE SET
					app_version_code  = EXCLUDED.app_version_code,
					app_version_name  = EXCLUDED.app_version_name,
					reviewer_language = EXCLUDED.reviewer_language,
					device            = EXCLUDED.device,
					updated_at        = EXCLUDED.updated_at,
					star_rating       = EXCLUDED.star_rating,
					review_title      = EXCLUDED.review_title,
					review_text       = EXCLUDED.review_text,
					reply_at          = EXCLUDED.reply_at,
					reply_text        = EXCLUDED.reply_text,
					review_link       = EXCLUDED.review_link
			`, r.PackageName, r.ReviewKey, r.AppVersionCode, r.AppVersionName,
				r.ReviewerLanguage, r.Device, r.SubmittedAt, r.UpdatedAt, r.StarRating,
				r.ReviewTitle, r.ReviewText, r.ReplyAt, r.ReplyText, r.ReviewLink)
		}
		if err := runBatch(batch, len(b.Reviews), "play_reviews"); err != nil {
			return 0, err
		}
	}

	if len(b.Vitals) > 0 {
		batch := &pgx.Batch{}
		for _, r := range b.Vitals {
			batch.Queue(`
				INSERT INTO euler_stats.play_vitals_timeseries (
					package_name, metric_set, aggregation_period, bucket_start,
					dimension_key, dimension_value, metrics_json
				) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
				ON CONFLICT (package_name, metric_set, aggregation_period, bucket_start, dimension_key, dimension_value)
				DO UPDATE SET
					metrics_json = EXCLUDED.metrics_json
			`, r.PackageName, r.MetricSet, r.AggregationPeriod, r.BucketStart,
				r.DimensionKey, r.DimensionValue, string(r.MetricsJSON))
		}
		if err := runBatch(batch, len(b.Vitals), "play_vitals_timeseries"); err != nil {
			return 0, err
		}
	}

	if len(b.Tracks) > 0 {
		batch := &pgx.Batch{}
		for _, r := range b.Tracks {
			batch.Queue(`
				INSERT INTO euler_stats.play_tracks (
					package_name, track_name, release_name, status, version_codes, release_notes, updated_at
				) VALUES ($1,$2,$3,$4,$5,$6,$7)
				ON CONFLICT (package_name, track_name) DO UPDATE SET
					release_name  = EXCLUDED.release_name,
					status        = EXCLUDED.status,
					version_codes = EXCLUDED.version_codes,
					release_notes = EXCLUDED.release_notes,
					updated_at    = EXCLUDED.updated_at
			`, r.PackageName, r.TrackName, r.ReleaseName, r.Status, r.VersionCodes, r.ReleaseNotes, r.UpdatedAt)
		}
		if err := runBatch(batch, len(b.Tracks), "play_tracks"); err != nil {
			return 0, err
		}
	}

	if len(b.Files) > 0 {
		batch := &pgx.Batch{}
		for _, f := range b.Files {
			batch.Queue(`
				INSERT INTO euler_stats.play_sync_files (
					object_name, etag, md5_hash, generation, size_bytes, object_updated_at, synced_at, rows_upserted
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
				ON CONFLICT (object_name) DO UPDATE SET
					etag              = EXCLUDED.etag,
					md5_hash          = EXCLUDED.md5_hash,
					generation        = EXCLUDED.generation,
					size_bytes        = EXCLUDED.size_bytes,
					object_updated_at = EXCLUDED.object_updated_at,
					synced_at         = EXCLUDED.synced_at,
					rows_upserted     = EXCLUDED.rows_upserted
			`, f.ObjectName, f.ETag, f.MD5Hash, f.Generation, f.SizeBytes, f.ObjectUpdatedAt, f.SyncedAt, f.RowsUpserted)
		}
		if err := runBatch(batch, len(b.Files), "play_sync_files"); err != nil {
			return 0, err
		}
	}

	var runID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO euler_stats.play_poll_runs (
			polled_at, duration_ms, status, error_message,
			gcs_objects_seen, gcs_objects_downloaded, gcs_rows_upserted,
			vitals_rows_upserted, reviews_upserted
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id
	`, run.PolledAt, run.DurationMs, run.Status, run.ErrorMessage,
		run.GCSObjectsSeen, run.GCSObjectsDownloaded, run.GCSRowsUpserted,
		run.VitalsRowsUpserted, run.ReviewsUpserted,
	).Scan(&runID)
	if err != nil {
		return 0, fmt.Errorf("insert play_poll_run: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit play sync: %w", err)
	}
	return runID, nil
}

// RecordPlayPollRun logs an error or skipped Play sync attempt.
func (s *Store) RecordPlayPollRun(ctx context.Context, run PlayPollRunInput) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO euler_stats.play_poll_runs (
			polled_at, duration_ms, status, error_message,
			gcs_objects_seen, gcs_objects_downloaded, gcs_rows_upserted,
			vitals_rows_upserted, reviews_upserted
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, run.PolledAt, run.DurationMs, run.Status, run.ErrorMessage,
		run.GCSObjectsSeen, run.GCSObjectsDownloaded, run.GCSRowsUpserted,
		run.VitalsRowsUpserted, run.ReviewsUpserted)
	return err
}
