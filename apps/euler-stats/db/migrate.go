package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ConnectWithRetry opens a pgx pool from DATABASE_URL, waiting for Postgres readiness on container startup.
func ConnectWithRetry(ctx context.Context, maxWait time.Duration) (*pgxpool.Pool, error) {
	deadline := time.Now().Add(maxWait)
	for {
		pool, err := Connect(ctx)
		if err == nil {
			return pool, nil
		}
		if time.Now().After(deadline) {
			return nil, err
		}
		log.Printf("waiting for postgres (%v)...", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// Connect creates a pgx connection pool from DATABASE_URL.
func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}

// Migrate ensures the euler_stats schema, tables, and indexes exist.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	const ddl = `
CREATE SCHEMA IF NOT EXISTS euler_stats;

CREATE TABLE IF NOT EXISTS euler_stats.poll_runs (
    id                   BIGSERIAL   PRIMARY KEY,
    polled_at            TIMESTAMPTZ NOT NULL,
    duration_ms          INTEGER     NOT NULL DEFAULT 0,
    status               TEXT        NOT NULL CHECK (status IN ('ok', 'error')),
    error_message        TEXT        NOT NULL DEFAULT '',
    releases_count       INTEGER     NOT NULL DEFAULT 0,
    assets_count         INTEGER     NOT NULL DEFAULT 0,
    total_downloads      BIGINT      NOT NULL DEFAULT 0,
    total_delta          BIGINT      NOT NULL DEFAULT 0,
    is_baseline          BOOLEAN     NOT NULL DEFAULT FALSE,
    rate_limit_remaining INTEGER,
    rate_limit_reset_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_euler_poll_runs_polled_at
    ON euler_stats.poll_runs (polled_at DESC);

CREATE TABLE IF NOT EXISTS euler_stats.assets (
    asset_id              BIGINT      PRIMARY KEY,
    release_id            BIGINT      NOT NULL,
    release_tag           TEXT        NOT NULL,
    release_name          TEXT        NOT NULL,
    asset_name            TEXT        NOT NULL,
    item_key              TEXT        NOT NULL,
    display_title         TEXT        NOT NULL,
    category              TEXT        NOT NULL,
    subject               TEXT        NOT NULL,
    language              TEXT        NOT NULL,
    edition               TEXT        NOT NULL,
    author                TEXT        NOT NULL DEFAULT '',
    license               TEXT        NOT NULL DEFAULT '',
    pages                 INTEGER     NOT NULL DEFAULT 0,
    exercises             INTEGER     NOT NULL DEFAULT 0,
    included_in_app       BOOLEAN     NOT NULL DEFAULT FALSE,
    size_bytes            BIGINT      NOT NULL DEFAULT 0,
    download_url          TEXT        NOT NULL DEFAULT '',
    asset_created_at      TIMESTAMPTZ,
    asset_updated_at      TIMESTAMPTZ,
    first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
    latest_download_count BIGINT      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_euler_assets_release_tag
    ON euler_stats.assets (release_tag);
CREATE INDEX IF NOT EXISTS idx_euler_assets_item_key
    ON euler_stats.assets (item_key);

CREATE TABLE IF NOT EXISTS euler_stats.asset_snapshots (
    id              BIGSERIAL   PRIMARY KEY,
    poll_run_id     BIGINT      NOT NULL REFERENCES euler_stats.poll_runs(id) ON DELETE CASCADE,
    polled_at       TIMESTAMPTZ NOT NULL,
    asset_id        BIGINT      NOT NULL REFERENCES euler_stats.assets(asset_id) ON DELETE CASCADE,
    release_tag     TEXT        NOT NULL,
    download_count  BIGINT      NOT NULL,
    delta_downloads BIGINT      NOT NULL DEFAULT 0,
    is_baseline     BOOLEAN     NOT NULL DEFAULT FALSE,
    size_bytes      BIGINT      NOT NULL DEFAULT 0,
    UNIQUE (poll_run_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_euler_snapshots_polled_at
    ON euler_stats.asset_snapshots (polled_at);
CREATE INDEX IF NOT EXISTS idx_euler_snapshots_asset_polled
    ON euler_stats.asset_snapshots (asset_id, polled_at DESC);
CREATE INDEX IF NOT EXISTS idx_euler_snapshots_release_polled
    ON euler_stats.asset_snapshots (release_tag, polled_at);
`
	if _, err := pool.Exec(ctx, ddl); err != nil {
		return fmt.Errorf("apply schema migration: %w", err)
	}
	return nil
}
