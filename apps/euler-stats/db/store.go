package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const pollAdvisoryLockID int64 = 884729104

// PollRunInput holds metadata for recording a poll attempt.
type PollRunInput struct {
	PolledAt           time.Time
	DurationMs         int
	Status             string
	ErrorMessage       string
	ReleasesCount      int
	AssetsCount        int
	TotalDownloads     int64
	TotalDelta         int64
	IsBaseline         bool
	RateLimitRemaining *int
	RateLimitResetAt   *time.Time
}

// AssetUpsert holds asset state and catalog enrichment for upsert.
type AssetUpsert struct {
	AssetID             int64
	ReleaseID           int64
	ReleaseTag          string
	ReleaseName         string
	AssetName           string
	ItemKey             string
	DisplayTitle        string
	Category            string
	Subject             string
	Language            string
	Edition             string
	Author              string
	License             string
	Pages               int
	Exercises           int
	IncludedInApp       bool
	SizeBytes           int64
	DownloadURL         string
	AssetCreatedAt      *time.Time
	AssetUpdatedAt      *time.Time
	SeenAt              time.Time
	LatestDownloadCount int64
}

// SnapshotInsert represents one hourly asset observation.
type SnapshotInsert struct {
	AssetID        int64
	ReleaseTag     string
	DownloadCount  int64
	DeltaDownloads int64
	IsBaseline     bool
	SizeBytes      int64
}

// Store wraps PostgreSQL persistence and analytics queries.
type Store struct {
	Pool *pgxpool.Pool
}

// NewStore returns a PostgreSQL-backed Store.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{Pool: pool}
}

// Ping verifies database connectivity.
func (s *Store) Ping(ctx context.Context) error {
	return s.Pool.Ping(ctx)
}

// TryAdvisoryLock acquires a session-level Postgres advisory lock to prevent concurrent polls.
func (s *Store) TryAdvisoryLock(ctx context.Context) (func(), bool, error) {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}
	var acquired bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, pollAdvisoryLockID).Scan(&acquired); err != nil {
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
		_, _ = conn.Exec(unlockCtx, `SELECT pg_advisory_unlock($1)`, pollAdvisoryLockID)
		conn.Release()
	}
	return unlock, true, nil
}

// PollHistoryBounds returns the earliest and latest successful poll timestamps, if any exist.
func (s *Store) PollHistoryBounds(ctx context.Context) (*time.Time, *time.Time, error) {
	var first, last *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT MIN(polled_at), MAX(polled_at)
		FROM euler_stats.poll_runs
		WHERE status = 'ok'
	`).Scan(&first, &last)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}
	return first, last, nil
}

// PreviousAssetCounts returns the last known cumulative download count for every seen asset.
func (s *Store) PreviousAssetCounts(ctx context.Context) (map[int64]int64, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT asset_id, latest_download_count
		FROM euler_stats.assets
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[int64]int64)
	for rows.Next() {
		var id, cnt int64
		if err := rows.Scan(&id, &cnt); err != nil {
			return nil, err
		}
		out[id] = cnt
	}
	return out, rows.Err()
}

// RecordSuccessfulPoll persists a poll run, upserts assets, and records hourly snapshots atomically.
func (s *Store) RecordSuccessfulPoll(
	ctx context.Context,
	run PollRunInput,
	assets []AssetUpsert,
	snapshots []SnapshotInsert,
) (int64, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var runID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO euler_stats.poll_runs (
			polled_at, duration_ms, status, error_message,
			releases_count, assets_count, total_downloads, total_delta,
			is_baseline, rate_limit_remaining, rate_limit_reset_at
		) VALUES ($1, $2, 'ok', '', $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`,
		run.PolledAt, run.DurationMs,
		run.ReleasesCount, run.AssetsCount, run.TotalDownloads, run.TotalDelta,
		run.IsBaseline, run.RateLimitRemaining, run.RateLimitResetAt,
	).Scan(&runID)
	if err != nil {
		return 0, fmt.Errorf("insert poll_run: %w", err)
	}

	if _, err := tx.Exec(ctx, `UPDATE euler_stats.assets SET is_active = FALSE WHERE is_active = TRUE`); err != nil {
		return 0, fmt.Errorf("deactivate stale assets: %w", err)
	}

	batch := &pgx.Batch{}
	for _, a := range assets {
		batch.Queue(`
			INSERT INTO euler_stats.assets (
				asset_id, release_id, release_tag, release_name, asset_name,
				item_key, display_title, category, subject, language, edition,
				author, license, pages, exercises, included_in_app,
				size_bytes, download_url, asset_created_at, asset_updated_at,
				first_seen_at, last_seen_at, is_active, latest_download_count
			) VALUES (
				$1, $2, $3, $4, $5,
				$6, $7, $8, $9, $10, $11,
				$12, $13, $14, $15, $16,
				$17, $18, $19, $20,
				$21, $21, TRUE, $22
			)
			ON CONFLICT (asset_id) DO UPDATE SET
				release_id            = EXCLUDED.release_id,
				release_tag           = EXCLUDED.release_tag,
				release_name          = EXCLUDED.release_name,
				asset_name            = EXCLUDED.asset_name,
				item_key              = EXCLUDED.item_key,
				display_title         = EXCLUDED.display_title,
				category              = EXCLUDED.category,
				subject               = EXCLUDED.subject,
				language              = EXCLUDED.language,
				edition               = EXCLUDED.edition,
				author                = EXCLUDED.author,
				license               = EXCLUDED.license,
				pages                 = EXCLUDED.pages,
				exercises             = EXCLUDED.exercises,
				included_in_app       = EXCLUDED.included_in_app,
				size_bytes            = EXCLUDED.size_bytes,
				download_url          = EXCLUDED.download_url,
				asset_created_at      = EXCLUDED.asset_created_at,
				asset_updated_at      = EXCLUDED.asset_updated_at,
				last_seen_at          = EXCLUDED.last_seen_at,
				is_active             = TRUE,
				latest_download_count = EXCLUDED.latest_download_count
		`,
			a.AssetID, a.ReleaseID, a.ReleaseTag, a.ReleaseName, a.AssetName,
			a.ItemKey, a.DisplayTitle, a.Category, a.Subject, a.Language, a.Edition,
			a.Author, a.License, a.Pages, a.Exercises, a.IncludedInApp,
			a.SizeBytes, a.DownloadURL, a.AssetCreatedAt, a.AssetUpdatedAt,
			a.SeenAt, a.LatestDownloadCount,
		)
	}
	br := tx.SendBatch(ctx, batch)
	for range assets {
		if _, err := br.Exec(); err != nil {
			_ = br.Close()
			return 0, fmt.Errorf("upsert asset: %w", err)
		}
	}
	if err := br.Close(); err != nil {
		return 0, fmt.Errorf("close asset batch: %w", err)
	}

	snapBatch := &pgx.Batch{}
	for _, s := range snapshots {
		snapBatch.Queue(`
			INSERT INTO euler_stats.asset_snapshots (
				poll_run_id, polled_at, asset_id, release_tag,
				download_count, delta_downloads, is_baseline, size_bytes
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`,
			runID, run.PolledAt, s.AssetID, s.ReleaseTag,
			s.DownloadCount, s.DeltaDownloads, s.IsBaseline, s.SizeBytes,
		)
	}
	sbr := tx.SendBatch(ctx, snapBatch)
	for range snapshots {
		if _, err := sbr.Exec(); err != nil {
			_ = sbr.Close()
			return 0, fmt.Errorf("insert snapshot: %w", err)
		}
	}
	if err := sbr.Close(); err != nil {
		return 0, fmt.Errorf("close snapshot batch: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit poll: %w", err)
	}
	return runID, nil
}

// RecordFailedPoll logs a failed poll attempt so operational issues are visible in the UI.
func (s *Store) RecordFailedPoll(ctx context.Context, run PollRunInput) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO euler_stats.poll_runs (
			polled_at, duration_ms, status, error_message,
			rate_limit_remaining, rate_limit_reset_at
		) VALUES ($1, $2, 'error', $3, $4, $5)
	`, run.PolledAt, run.DurationMs, run.ErrorMessage, run.RateLimitRemaining, run.RateLimitResetAt)
	return err
}
