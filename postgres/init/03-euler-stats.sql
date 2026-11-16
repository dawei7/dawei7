-- Professor Euler Statistics schema
-- Runs automatically when the postgres container first starts.
-- Idempotent — safe to re-run on existing deployments:
--   psql "$DATABASE_URL" -f postgres/init/03-euler-stats.sql

\c dawei_db;

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

-- ─── GOOGLE PLAY STORE TABLES ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS euler_stats.play_sync_files (
    object_name       TEXT        PRIMARY KEY,
    etag              TEXT        NOT NULL,
    md5_hash          TEXT        NOT NULL DEFAULT '',
    generation        BIGINT      NOT NULL DEFAULT 0,
    size_bytes        BIGINT      NOT NULL DEFAULT 0,
    object_updated_at TIMESTAMPTZ,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    rows_upserted     INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS euler_stats.play_installs_daily (
    report_date             DATE   NOT NULL,
    package_name            TEXT   NOT NULL,
    dimension_type          TEXT   NOT NULL,
    dimension_value         TEXT   NOT NULL,
    daily_device_installs   BIGINT NOT NULL DEFAULT 0,
    daily_device_uninstalls BIGINT NOT NULL DEFAULT 0,
    daily_device_upgrades   BIGINT NOT NULL DEFAULT 0,
    total_user_installs     BIGINT NOT NULL DEFAULT 0,
    daily_user_installs     BIGINT NOT NULL DEFAULT 0,
    daily_user_uninstalls   BIGINT NOT NULL DEFAULT 0,
    active_device_installs  BIGINT NOT NULL DEFAULT 0,
    install_events          BIGINT NOT NULL DEFAULT 0,
    update_events           BIGINT NOT NULL DEFAULT 0,
    uninstall_events        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (report_date, package_name, dimension_type, dimension_value)
);

CREATE INDEX IF NOT EXISTS idx_play_installs_dim_date
    ON euler_stats.play_installs_daily (dimension_type, report_date);

CREATE TABLE IF NOT EXISTS euler_stats.play_store_performance_daily (
    report_date     DATE             NOT NULL,
    package_name    TEXT             NOT NULL,
    dimension_type  TEXT             NOT NULL,
    dimension_value TEXT             NOT NULL,
    search_term     TEXT             NOT NULL DEFAULT '',
    utm_source      TEXT             NOT NULL DEFAULT '',
    utm_campaign    TEXT             NOT NULL DEFAULT '',
    acquisitions    BIGINT           NOT NULL DEFAULT 0,
    visitors        BIGINT           NOT NULL DEFAULT 0,
    conversion_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (report_date, package_name, dimension_type, dimension_value, search_term, utm_source, utm_campaign)
);

CREATE INDEX IF NOT EXISTS idx_play_store_perf_dim_date
    ON euler_stats.play_store_performance_daily (dimension_type, report_date);

CREATE TABLE IF NOT EXISTS euler_stats.play_ratings_daily (
    report_date      DATE             NOT NULL,
    package_name     TEXT             NOT NULL,
    dimension_type   TEXT             NOT NULL,
    dimension_value  TEXT             NOT NULL,
    daily_avg_rating DOUBLE PRECISION,
    total_avg_rating DOUBLE PRECISION,
    PRIMARY KEY (report_date, package_name, dimension_type, dimension_value)
);

CREATE TABLE IF NOT EXISTS euler_stats.play_crashes_daily (
    report_date     DATE   NOT NULL,
    package_name    TEXT   NOT NULL,
    dimension_type  TEXT   NOT NULL,
    dimension_value TEXT   NOT NULL,
    daily_crashes   BIGINT NOT NULL DEFAULT 0,
    daily_anrs      BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (report_date, package_name, dimension_type, dimension_value)
);

CREATE TABLE IF NOT EXISTS euler_stats.play_reviews (
    package_name       TEXT        NOT NULL,
    review_key         TEXT        NOT NULL,
    app_version_code   TEXT        NOT NULL DEFAULT '',
    app_version_name   TEXT        NOT NULL DEFAULT '',
    reviewer_language  TEXT        NOT NULL DEFAULT '',
    device             TEXT        NOT NULL DEFAULT '',
    submitted_at       TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    star_rating        INTEGER     NOT NULL,
    review_title       TEXT        NOT NULL DEFAULT '',
    review_text        TEXT        NOT NULL DEFAULT '',
    reply_at           TIMESTAMPTZ,
    reply_text         TEXT        NOT NULL DEFAULT '',
    review_link        TEXT        NOT NULL DEFAULT '',
    PRIMARY KEY (package_name, review_key)
);

CREATE INDEX IF NOT EXISTS idx_play_reviews_submitted
    ON euler_stats.play_reviews (submitted_at DESC);

CREATE TABLE IF NOT EXISTS euler_stats.play_vitals_timeseries (
    package_name       TEXT        NOT NULL,
    metric_set         TEXT        NOT NULL,
    aggregation_period TEXT        NOT NULL,
    bucket_start       TIMESTAMPTZ NOT NULL,
    dimension_key      TEXT        NOT NULL DEFAULT '',
    dimension_value    TEXT        NOT NULL DEFAULT '',
    metrics_json       JSONB       NOT NULL,
    PRIMARY KEY (package_name, metric_set, aggregation_period, bucket_start, dimension_key, dimension_value)
);

CREATE INDEX IF NOT EXISTS idx_play_vitals_period_bucket
    ON euler_stats.play_vitals_timeseries (metric_set, aggregation_period, bucket_start DESC);

CREATE TABLE IF NOT EXISTS euler_stats.play_tracks (
    package_name  TEXT        NOT NULL,
    track_name    TEXT        NOT NULL,
    release_name  TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT '',
    version_codes TEXT        NOT NULL DEFAULT '',
    release_notes TEXT        NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (package_name, track_name)
);

CREATE TABLE IF NOT EXISTS euler_stats.play_poll_runs (
    id                     BIGSERIAL   PRIMARY KEY,
    polled_at              TIMESTAMPTZ NOT NULL,
    duration_ms            INTEGER     NOT NULL DEFAULT 0,
    status                 TEXT        NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
    error_message          TEXT        NOT NULL DEFAULT '',
    gcs_objects_seen       INTEGER     NOT NULL DEFAULT 0,
    gcs_objects_downloaded INTEGER     NOT NULL DEFAULT 0,
    gcs_rows_upserted      INTEGER     NOT NULL DEFAULT 0,
    vitals_rows_upserted   INTEGER     NOT NULL DEFAULT 0,
    reviews_upserted       INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_play_poll_runs_polled_at
    ON euler_stats.play_poll_runs (polled_at DESC);
