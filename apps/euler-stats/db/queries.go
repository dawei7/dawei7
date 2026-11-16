package db

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Granularity represents a supported time-series bucket size.
type Granularity string

const (
	GranularityHour  Granularity = "hour"
	Granularity6Hour Granularity = "6h"
	GranularityDay   Granularity = "day"
	GranularityWeek  Granularity = "week"
	GranularityMonth Granularity = "month"
)

// ParseGranularity validates a granularity string, defaulting to "day".
func ParseGranularity(s string) (Granularity, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "day", "1d":
		return GranularityDay, true
	case "hour", "1h":
		return GranularityHour, true
	case "6h":
		return Granularity6Hour, true
	case "week", "1w":
		return GranularityWeek, true
	case "month", "1m":
		return GranularityMonth, true
	default:
		return "", false
	}
}

// GroupBy represents the breakdown series dimension for time-series charts.
type GroupBy string

const (
	GroupByRelease  GroupBy = "release"
	GroupByLanguage GroupBy = "language"
	GroupByEdition  GroupBy = "edition"
	GroupByNone     GroupBy = "none"
)

// ParseGroupBy validates a group_by dimension, defaulting to "release".
func ParseGroupBy(s string) (GroupBy, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "release":
		return GroupByRelease, true
	case "language":
		return GroupByLanguage, true
	case "edition":
		return GroupByEdition, true
	case "none":
		return GroupByNone, true
	default:
		return "", false
	}
}

// AssetMode determines whether the leaderboard aggregates across deleted/replaced versions per item
// or lists individual GitHub release asset files.
type AssetMode string

const (
	AssetModeItems AssetMode = "items"
	AssetModeFiles AssetMode = "files"
)

// ParseAssetMode validates an asset listing mode, defaulting to "items".
func ParseAssetMode(s string) (AssetMode, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "items", "workbooks":
		return AssetModeItems, true
	case "files", "assets", "versions":
		return AssetModeFiles, true
	default:
		return "", false
	}
}

// QueryParams filters and configures analytics queries.
type QueryParams struct {
	From        time.Time
	To          time.Time
	TZName      string
	Loc         *time.Location
	Granularity Granularity
	GroupBy     GroupBy
	Release     string
	Category    string
	Subject     string
	Language    string
	Edition     string
	Search      string
	AssetID     int64
	ItemKey     string
}

// PollerStatus summarizes the hourly background collector state.
type PollerStatus struct {
	Status             string     `json:"status"`
	LastPolledAt       *time.Time `json:"last_polled_at"`
	LastSuccessAt      *time.Time `json:"last_success_at"`
	FirstPolledAt      *time.Time `json:"first_polled_at"`
	NextScheduledAt    time.Time  `json:"next_scheduled_at"`
	TotalPolls         int        `json:"total_polls"`
	SuccessfulPolls    int        `json:"successful_polls"`
	FailedPolls        int        `json:"failed_polls"`
	LastError          string     `json:"last_error"`
	LastDurationMs     int        `json:"last_duration_ms"`
	RateLimitRemaining *int       `json:"rate_limit_remaining"`
	RateLimitResetAt   *time.Time `json:"rate_limit_reset_at"`
}

// BreakdownItem represents aggregated metrics for a single category/dimension value.
type BreakdownItem struct {
	Key              string  `json:"key"`
	AllTimeDownloads int64   `json:"all_time_downloads"`
	WindowDelta      int64   `json:"window_delta"`
	AssetCount       int     `json:"asset_count"`
	TotalBytes       int64   `json:"total_bytes"`
	SharePct         float64 `json:"share_pct"`
}

// FilterOptions enumerates available filter facets from stored assets.
type FilterOptions struct {
	Releases   []string `json:"releases"`
	Categories []string `json:"categories"`
	Subjects   []string `json:"subjects"`
	Languages  []string `json:"languages"`
	Editions   []string `json:"editions"`
}

// OverviewResponse summarizes KPI totals, window deltas, breakdowns, and poller health.
type OverviewResponse struct {
	AllTime struct {
		TotalDownloads       int64   `json:"total_downloads"`
		BaselineDownloads    int64   `json:"baseline_downloads"`
		TrackedDelta         int64   `json:"tracked_delta"`
		CurriculumDownloads  int64   `json:"curriculum_downloads"`
		BooksDownloads       int64   `json:"books_downloads"`
		TotalAssets          int     `json:"total_assets"`
		ActiveAssets         int     `json:"active_assets"`
		TotalBytes           int64   `json:"total_bytes"`
		TrackingDays         float64 `json:"tracking_days"`
		LatestAssetUpdatedAt *time.Time `json:"latest_asset_updated_at"`
	} `json:"all_time"`
	Window struct {
		From             time.Time `json:"from"`
		To               time.Time `json:"to"`
		DeltaDownloads   int64     `json:"delta_downloads"`
		PrevDelta        *int64    `json:"prev_delta"`
		ChangePct        *float64  `json:"change_pct"`
		AvgPerHour       float64   `json:"avg_per_hour"`
		AvgPerDay        float64   `json:"avg_per_day"`
		ActiveAssetsUsed int       `json:"active_assets_used"`
	} `json:"window"`
	Poller     PollerStatus    `json:"poller"`
	Filters    FilterOptions   `json:"filters"`
	ByRelease  []BreakdownItem `json:"by_release"`
	ByLanguage []BreakdownItem `json:"by_language"`
	ByEdition  []BreakdownItem `json:"by_edition"`
	BySubject  []BreakdownItem `json:"by_subject"`
	ByCategory []BreakdownItem `json:"by_category"`
}

// TimeSeriesBucket represents one gap-filled time bucket.
type TimeSeriesBucket struct {
	Timestamp  time.Time        `json:"timestamp"`
	Label      string           `json:"label"`
	Delta      int64            `json:"delta"`
	Cumulative *int64           `json:"cumulative"`
	Series     map[string]int64 `json:"series"`
	CumSeries  map[string]int64 `json:"cum_series"`
}

// ActivityCell represents one cell in the 7×24 day-of-week × hour heatmap.
type ActivityCell struct {
	DayOfWeek   int     `json:"day_of_week"` // 1=Monday .. 7=Sunday
	Hour        int     `json:"hour"`        // 0..23
	TotalDelta  int64   `json:"total_delta"`
	SampleCount int     `json:"sample_count"`
	AvgDelta    float64 `json:"avg_delta"`
}

// HourProfilePoint represents activity aggregated by hour-of-day (0..23).
type HourProfilePoint struct {
	Hour       int     `json:"hour"`
	TotalDelta int64   `json:"total_delta"`
	AvgDelta   float64 `json:"avg_delta"`
}

// TimeSeriesResponse holds buckets, series keys, and hourly activity patterns.
type TimeSeriesResponse struct {
	Granularity    Granularity        `json:"granularity"`
	GroupBy        GroupBy            `json:"group_by"`
	Timezone       string             `json:"timezone"`
	From           time.Time          `json:"from"`
	To             time.Time          `json:"to"`
	SeriesKeys     []string           `json:"series_keys"`
	Buckets        []TimeSeriesBucket `json:"buckets"`
	ActivityMatrix []ActivityCell     `json:"activity_matrix"`
	HourlyProfile  []HourProfilePoint `json:"hourly_profile"`
}

// AssetRow represents an enriched asset or version-accumulated logical item row in the leaderboard.
type AssetRow struct {
	AssetID                 int64      `json:"asset_id"`
	ReleaseTag              string     `json:"release_tag"`
	ReleaseName             string     `json:"release_name"`
	AssetName               string     `json:"asset_name"`
	ItemKey                 string     `json:"item_key"`
	DisplayTitle            string     `json:"display_title"`
	Category                string     `json:"category"`
	Subject                 string     `json:"subject"`
	Language                string     `json:"language"`
	Edition                 string     `json:"edition"`
	Author                  string     `json:"author"`
	License                 string     `json:"license"`
	Pages                   int        `json:"pages"`
	Exercises               int        `json:"exercises"`
	IncludedInApp           bool       `json:"included_in_app"`
	SizeBytes               int64      `json:"size_bytes"`
	DownloadURL             string     `json:"download_url"`
	AssetCreatedAt          *time.Time `json:"asset_created_at"`
	AssetUpdatedAt          *time.Time `json:"asset_updated_at"`
	FirstSeenAt             time.Time  `json:"first_seen_at"`
	LastSeenAt              time.Time  `json:"last_seen_at"`
	IsActive                bool       `json:"is_active"`
	VersionCount            int        `json:"version_count"`
	CurrentVersionDownloads int64      `json:"current_version_downloads"`
	AllTimeDownloads        int64      `json:"all_time_downloads"`
	WindowDelta             int64      `json:"window_delta"`
	Last24hDelta            int64      `json:"last_24h_delta"`
	Last7dDelta             int64      `json:"last_7d_delta"`
	SharePct                float64    `json:"share_pct"`
}

// PollRunRow represents a row in the collector audit log.
type PollRunRow struct {
	ID                 int64      `json:"id"`
	PolledAt           time.Time  `json:"polled_at"`
	DurationMs         int        `json:"duration_ms"`
	Status             string     `json:"status"`
	ErrorMessage       string     `json:"error_message"`
	ReleasesCount      int        `json:"releases_count"`
	AssetsCount        int        `json:"assets_count"`
	TotalDownloads     int64      `json:"total_downloads"`
	TotalDelta         int64      `json:"total_delta"`
	IsBaseline         bool       `json:"is_baseline"`
	RateLimitRemaining *int       `json:"rate_limit_remaining"`
	RateLimitResetAt   *time.Time `json:"rate_limit_reset_at"`
}

// buildAssetWhere builds parameterized SQL conditions on alias `a`.
func buildAssetWhere(p QueryParams, startIdx int) (string, []any) {
	conds := []string{"(a.is_active OR a.latest_download_count > 0)"}
	var args []any
	idx := startIdx

	addEq := func(col, val string) {
		if val == "" || strings.EqualFold(val, "all") {
			return
		}
		conds = append(conds, fmt.Sprintf("%s = $%d", col, idx))
		args = append(args, val)
		idx++
	}

	addEq("a.release_tag", p.Release)
	addEq("a.category", p.Category)
	addEq("a.subject", p.Subject)
	addEq("a.language", p.Language)
	addEq("a.edition", p.Edition)
	addEq("a.item_key", p.ItemKey)

	if p.AssetID > 0 {
		conds = append(conds, fmt.Sprintf("a.asset_id = $%d", idx))
		args = append(args, p.AssetID)
		idx++
	}

	if q := strings.TrimSpace(p.Search); q != "" {
		words := strings.Fields(q)
		for _, w := range words {
			pat := "%" + w + "%"
			conds = append(conds, fmt.Sprintf(
				"(a.display_title ILIKE $%d OR a.asset_name ILIKE $%d OR a.subject ILIKE $%d OR a.author ILIKE $%d)",
				idx, idx, idx, idx,
			))
			args = append(args, pat)
			idx++
		}
	}

	if len(conds) == 0 {
		return "TRUE", args
	}
	return strings.Join(conds, " AND "), args
}

func bucketSQLExpr(gran Granularity, col string, tzParamIdx int) (string, bool, error) {
	switch gran {
	case GranularityHour:
		// Real 60-minute UTC-aligned buckets avoid DST duplicate wall-clock hours.
		return fmt.Sprintf("date_trunc('hour', %s)", col), false, nil
	case Granularity6Hour:
		local := fmt.Sprintf("(%s AT TIME ZONE $%d)", col, tzParamIdx)
		return fmt.Sprintf("(date_trunc('day', %s) + (floor(extract(hour from %s)::int / 6) * interval '6 hours')) AT TIME ZONE $%d",
			local, local, tzParamIdx), true, nil
	case GranularityDay:
		return fmt.Sprintf("date_trunc('day', %s AT TIME ZONE $%d) AT TIME ZONE $%d", col, tzParamIdx, tzParamIdx), true, nil
	case GranularityWeek:
		return fmt.Sprintf("date_trunc('week', %s AT TIME ZONE $%d) AT TIME ZONE $%d", col, tzParamIdx, tzParamIdx), true, nil
	case GranularityMonth:
		return fmt.Sprintf("date_trunc('month', %s AT TIME ZONE $%d) AT TIME ZONE $%d", col, tzParamIdx, tzParamIdx), true, nil
	default:
		return "", false, fmt.Errorf("unsupported granularity: %s", gran)
	}
}

func groupSQLExpr(gb GroupBy) string {
	switch gb {
	case GroupByRelease:
		return "a.release_tag"
	case GroupByLanguage:
		return "a.language"
	case GroupByEdition:
		return "a.edition"
	default:
		return "'total'"
	}
}

// AlignBucketStart returns the start timestamp of the bucket containing t in loc.
func AlignBucketStart(t time.Time, gran Granularity, loc *time.Location) time.Time {
	switch gran {
	case GranularityHour:
		return t.UTC().Truncate(time.Hour)
	case Granularity6Hour:
		lt := t.In(loc)
		h := (lt.Hour() / 6) * 6
		return time.Date(lt.Year(), lt.Month(), lt.Day(), h, 0, 0, 0, loc)
	case GranularityDay:
		lt := t.In(loc)
		return time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, loc)
	case GranularityWeek:
		lt := t.In(loc)
		// ISO week starts Monday.
		offset := (int(lt.Weekday()) + 6) % 7
		monday := time.Date(lt.Year(), lt.Month(), lt.Day()-offset, 0, 0, 0, 0, loc)
		return monday
	case GranularityMonth:
		lt := t.In(loc)
		return time.Date(lt.Year(), lt.Month(), 1, 0, 0, 0, 0, loc)
	default:
		return t.UTC().Truncate(24 * time.Hour)
	}
}

// StepBucket advances a bucket start timestamp by exactly one bucket.
func StepBucket(t time.Time, gran Granularity, loc *time.Location) time.Time {
	switch gran {
	case GranularityHour:
		return t.UTC().Add(time.Hour)
	case Granularity6Hour:
		lt := t.In(loc)
		nextH := ((lt.Hour() / 6) * 6) + 6
		return time.Date(lt.Year(), lt.Month(), lt.Day(), nextH, 0, 0, 0, loc)
	case GranularityDay:
		lt := t.In(loc)
		return time.Date(lt.Year(), lt.Month(), lt.Day()+1, 0, 0, 0, 0, loc)
	case GranularityWeek:
		lt := t.In(loc)
		return time.Date(lt.Year(), lt.Month(), lt.Day()+7, 0, 0, 0, 0, loc)
	case GranularityMonth:
		lt := t.In(loc)
		return time.Date(lt.Year(), lt.Month()+1, 1, 0, 0, 0, 0, loc)
	default:
		return t.Add(24 * time.Hour)
	}
}

// FormatBucketLabel formats a bucket start timestamp cleanly for charts and CSVs.
func FormatBucketLabel(t time.Time, gran Granularity, loc *time.Location) string {
	lt := t.In(loc)
	switch gran {
	case GranularityHour, Granularity6Hour:
		return lt.Format("Jan 02 15:04")
	case GranularityDay:
		return lt.Format("Jan 02")
	case GranularityWeek:
		return "Wk " + lt.Format("Jan 02")
	case GranularityMonth:
		return lt.Format("Jan 2006")
	default:
		return lt.Format(time.RFC3339)
	}
}

// BuildBucketSpine produces all bucket starts covering [from, to], capped safely.
func BuildBucketSpine(from, to time.Time, gran Granularity, loc *time.Location) []time.Time {
	if to.Before(from) {
		return nil
	}
	start := AlignBucketStart(from, gran, loc)
	end := AlignBucketStart(to, gran, loc)

	const maxBuckets = 2500
	var out []time.Time
	cur := start
	for !cur.After(end) && len(out) < maxBuckets {
		out = append(out, cur)
		next := StepBucket(cur, gran, loc)
		if !next.After(cur) {
			break
		}
		cur = next
	}
	return out
}

// NextTopOfHour returns the next UTC hour boundary + 5 seconds.
func NextTopOfHour(now time.Time) time.Time {
	return now.UTC().Truncate(time.Hour).Add(time.Hour).Add(5 * time.Second)
}

// GetOverview returns KPI cards, poller status, filter options, and breakdowns.
func (s *Store) GetOverview(ctx context.Context, p QueryParams) (OverviewResponse, error) {
	var out OverviewResponse
	out.Window.From = p.From
	out.Window.To = p.To

	whereSQL, whereArgs := buildAssetWhere(p, 1)

	// 1. All-time totals across matching assets (accumulated across deleted/replaced versions).
	var latestUpdated *time.Time
	qAllTime := fmt.Sprintf(`
		SELECT
			COALESCE(SUM(a.latest_download_count), 0)::bigint,
			COALESCE(SUM(CASE WHEN a.release_tag = 'curriculum' THEN a.latest_download_count ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN a.release_tag = 'books' THEN a.latest_download_count ELSE 0 END), 0)::bigint,
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE a.is_active)::int,
			COALESCE(SUM(CASE WHEN a.is_active THEN a.size_bytes ELSE 0 END), 0)::bigint,
			MAX(a.asset_updated_at)
		FROM euler_stats.assets a
		WHERE %s
	`, whereSQL)
	if err := s.Pool.QueryRow(ctx, qAllTime, whereArgs...).Scan(
		&out.AllTime.TotalDownloads,
		&out.AllTime.CurriculumDownloads,
		&out.AllTime.BooksDownloads,
		&out.AllTime.TotalAssets,
		&out.AllTime.ActiveAssets,
		&out.AllTime.TotalBytes,
		&latestUpdated,
	); err != nil {
		return out, fmt.Errorf("overview all-time: %w", err)
	}
	out.AllTime.LatestAssetUpdatedAt = latestUpdated

	// Baseline vs tracked deltas across matching assets.
	qTracked := fmt.Sprintf(`
		SELECT
			COALESCE(SUM(CASE WHEN s.is_baseline THEN s.download_count ELSE 0 END), 0)::bigint,
			COALESCE(SUM(s.delta_downloads), 0)::bigint
		FROM euler_stats.asset_snapshots s
		JOIN euler_stats.assets a ON a.asset_id = s.asset_id
		WHERE %s
	`, whereSQL)
	if err := s.Pool.QueryRow(ctx, qTracked, whereArgs...).Scan(
		&out.AllTime.BaselineDownloads,
		&out.AllTime.TrackedDelta,
	); err != nil {
		return out, fmt.Errorf("overview tracked delta: %w", err)
	}

	// 2. Window delta + active assets count + previous equal window comparison.
	fromIdx := len(whereArgs) + 1
	toIdx := len(whereArgs) + 2
	winArgs := append(append([]any{}, whereArgs...), p.From, p.To)
	qWindow := fmt.Sprintf(`
		SELECT
			COALESCE(SUM(s.delta_downloads), 0)::bigint,
			COUNT(DISTINCT CASE WHEN s.delta_downloads > 0 THEN s.asset_id END)::int
		FROM euler_stats.asset_snapshots s
		JOIN euler_stats.assets a ON a.asset_id = s.asset_id
		WHERE %s AND s.polled_at >= $%d AND s.polled_at <= $%d
	`, whereSQL, fromIdx, toIdx)
	if err := s.Pool.QueryRow(ctx, qWindow, winArgs...).Scan(
		&out.Window.DeltaDownloads,
		&out.Window.ActiveAssetsUsed,
	); err != nil {
		return out, fmt.Errorf("overview window: %w", err)
	}

	spanHours := p.To.Sub(p.From).Hours()
	if spanHours < 1 {
		spanHours = 1
	}
	out.Window.AvgPerHour = round2(float64(out.Window.DeltaDownloads) / spanHours)
	out.Window.AvgPerDay = round2(float64(out.Window.DeltaDownloads) / (spanHours / 24.0))

	// Previous window comparison (only when we have snapshots in the prior window).
	dur := p.To.Sub(p.From)
	prevFrom := p.From.Add(-dur)
	prevTo := p.From
	prevArgs := append(append([]any{}, whereArgs...), prevFrom, prevTo)
	var prevHasRows bool
	var prevDelta int64
	qPrev := fmt.Sprintf(`
		SELECT
			COUNT(*) > 0,
			COALESCE(SUM(s.delta_downloads), 0)::bigint
		FROM euler_stats.asset_snapshots s
		JOIN euler_stats.assets a ON a.asset_id = s.asset_id
		WHERE %s AND s.polled_at >= $%d AND s.polled_at < $%d
	`, whereSQL, fromIdx, toIdx)
	if err := s.Pool.QueryRow(ctx, qPrev, prevArgs...).Scan(&prevHasRows, &prevDelta); err != nil {
		return out, fmt.Errorf("overview prev window: %w", err)
	}
	if prevHasRows {
		out.Window.PrevDelta = &prevDelta
		if prevDelta > 0 {
			pct := round2((float64(out.Window.DeltaDownloads-prevDelta) / float64(prevDelta)) * 100.0)
			out.Window.ChangePct = &pct
		}
	}

	// 3. Poller status.
	pollerStatus, err := s.getPollerStatus(ctx)
	if err != nil {
		return out, fmt.Errorf("overview poller: %w", err)
	}
	out.Poller = pollerStatus
	if pollerStatus.FirstPolledAt != nil {
		out.AllTime.TrackingDays = round2(time.Since(*pollerStatus.FirstPolledAt).Hours() / 24.0)
	}

	// 4. Filter facets (from all assets so dropdowns stay populated).
	filters, err := s.getFilterOptions(ctx)
	if err != nil {
		return out, fmt.Errorf("overview filters: %w", err)
	}
	out.Filters = filters

	// 5. Breakdowns.
	if out.ByRelease, err = s.queryBreakdown(ctx, "a.release_tag", whereSQL, whereArgs, p.From, p.To, out.AllTime.TotalDownloads); err != nil {
		return out, err
	}
	if out.ByLanguage, err = s.queryBreakdown(ctx, "a.language", whereSQL, whereArgs, p.From, p.To, out.AllTime.TotalDownloads); err != nil {
		return out, err
	}
	if out.ByEdition, err = s.queryBreakdown(ctx, "a.edition", whereSQL, whereArgs, p.From, p.To, out.AllTime.TotalDownloads); err != nil {
		return out, err
	}
	if out.BySubject, err = s.queryBreakdown(ctx, "a.subject", whereSQL, whereArgs, p.From, p.To, out.AllTime.TotalDownloads); err != nil {
		return out, err
	}
	if out.ByCategory, err = s.queryBreakdown(ctx, "a.category", whereSQL, whereArgs, p.From, p.To, out.AllTime.TotalDownloads); err != nil {
		return out, err
	}

	return out, nil
}

func (s *Store) getPollerStatus(ctx context.Context) (PollerStatus, error) {
	ps := PollerStatus{
		Status:          "initializing",
		NextScheduledAt: NextTopOfHour(time.Now()),
	}

	err := s.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE status = 'ok')::int,
			COUNT(*) FILTER (WHERE status = 'error')::int,
			MIN(polled_at) FILTER (WHERE status = 'ok'),
			MAX(polled_at) FILTER (WHERE status = 'ok')
		FROM euler_stats.poll_runs
	`).Scan(&ps.TotalPolls, &ps.SuccessfulPolls, &ps.FailedPolls, &ps.FirstPolledAt, &ps.LastSuccessAt)
	if err != nil {
		return ps, err
	}

	var status, errMsg string
	var polledAt time.Time
	var durMs int
	var rlRem *int
	var rlReset *time.Time
	err = s.Pool.QueryRow(ctx, `
		SELECT status, polled_at, duration_ms, error_message, rate_limit_remaining, rate_limit_reset_at
		FROM euler_stats.poll_runs
		ORDER BY polled_at DESC, id DESC
		LIMIT 1
	`).Scan(&status, &polledAt, &durMs, &errMsg, &rlRem, &rlReset)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ps, nil
		}
		return ps, err
	}
	ps.Status = status
	ps.LastPolledAt = &polledAt
	ps.LastDurationMs = durMs
	ps.LastError = errMsg
	ps.RateLimitRemaining = rlRem
	ps.RateLimitResetAt = rlReset
	return ps, nil
}

func (s *Store) getFilterOptions(ctx context.Context) (FilterOptions, error) {
	var f FilterOptions
	f.Releases = []string{}
	f.Categories = []string{}
	f.Subjects = []string{}
	f.Languages = []string{}
	f.Editions = []string{}

	scanDistinct := func(col string) ([]string, error) {
		rows, err := s.Pool.Query(ctx, fmt.Sprintf(`SELECT DISTINCT %s FROM euler_stats.assets WHERE %s <> '' ORDER BY 1`, col, col))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, rows.Err()
	}

	var err error
	if f.Releases, err = scanDistinct("release_tag"); err != nil {
		return f, err
	}
	if f.Categories, err = scanDistinct("category"); err != nil {
		return f, err
	}
	if f.Subjects, err = scanDistinct("subject"); err != nil {
		return f, err
	}
	if f.Languages, err = scanDistinct("language"); err != nil {
		return f, err
	}
	if f.Editions, err = scanDistinct("edition"); err != nil {
		return f, err
	}
	return f, nil
}

func (s *Store) queryBreakdown(
	ctx context.Context,
	dimCol string,
	whereSQL string,
	whereArgs []any,
	from, to time.Time,
	grandTotal int64,
) ([]BreakdownItem, error) {
	fromIdx := len(whereArgs) + 1
	toIdx := len(whereArgs) + 2
	args := append(append([]any{}, whereArgs...), from, to)

	q := fmt.Sprintf(`
		WITH filtered AS (
			SELECT a.asset_id, %s AS dim_key, a.latest_download_count, a.size_bytes, a.is_active
			FROM euler_stats.assets a
			WHERE %s
		),
		deltas AS (
			SELECT f.dim_key, COALESCE(SUM(s.delta_downloads), 0)::bigint AS window_delta
			FROM filtered f
			LEFT JOIN euler_stats.asset_snapshots s
				ON s.asset_id = f.asset_id AND s.polled_at >= $%d AND s.polled_at <= $%d
			GROUP BY f.dim_key
		)
		SELECT
			f.dim_key,
			COALESCE(SUM(f.latest_download_count), 0)::bigint AS all_time,
			COALESCE(MAX(d.window_delta), 0)::bigint AS window_delta,
			COUNT(*) FILTER (WHERE f.is_active)::int AS asset_count,
			COALESCE(SUM(CASE WHEN f.is_active THEN f.size_bytes ELSE 0 END), 0)::bigint AS total_bytes
		FROM filtered f
		LEFT JOIN deltas d ON d.dim_key = f.dim_key
		GROUP BY f.dim_key
		ORDER BY all_time DESC, window_delta DESC, f.dim_key ASC
	`, dimCol, whereSQL, fromIdx, toIdx)

	rows, err := s.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("breakdown %s: %w", dimCol, err)
	}
	defer rows.Close()

	out := []BreakdownItem{}
	for rows.Next() {
		var item BreakdownItem
		if err := rows.Scan(&item.Key, &item.AllTimeDownloads, &item.WindowDelta, &item.AssetCount, &item.TotalBytes); err != nil {
			return nil, err
		}
		if grandTotal > 0 {
			item.SharePct = round2((float64(item.AllTimeDownloads) / float64(grandTotal)) * 100.0)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// GetTimeSeries returns continuous gap-filled time-series buckets and hourly activity patterns.
func (s *Store) GetTimeSeries(ctx context.Context, p QueryParams) (TimeSeriesResponse, error) {
	resp := TimeSeriesResponse{
		Granularity:    p.Granularity,
		GroupBy:        p.GroupBy,
		Timezone:       p.TZName,
		From:           p.From,
		To:             p.To,
		SeriesKeys:     []string{},
		Buckets:        []TimeSeriesBucket{},
		ActivityMatrix: []ActivityCell{},
		HourlyProfile:  []HourProfilePoint{},
	}

	alignedFrom := AlignBucketStart(p.From, p.Granularity, p.Loc)
	if alignedFrom.Before(p.From) {
		resp.From = alignedFrom
	}

	whereSQL, whereArgs := buildAssetWhere(p, 1)
	fromIdx := len(whereArgs) + 1
	toIdx := len(whereArgs) + 2
	tzIdx := len(whereArgs) + 3

	bucketExpr, usesTZ, err := bucketSQLExpr(p.Granularity, "s.polled_at", tzIdx)
	if err != nil {
		return resp, err
	}
	pollBucketExpr, _, err := bucketSQLExpr(p.Granularity, "pr.polled_at", tzIdx)
	if err != nil {
		return resp, err
	}
	grpExpr := groupSQLExpr(p.GroupBy)

	bucketArgs := append(append([]any{}, whereArgs...), alignedFrom, p.To)
	if usesTZ {
		bucketArgs = append(bucketArgs, p.TZName)
	}
	matrixArgs := append(append([]any{}, whereArgs...), alignedFrom, p.To, p.TZName)

	// 1. Delta by bucket and group.
	deltaMap := make(map[int64]map[string]int64)
	seriesSet := make(map[string]struct{})

	qDelta := fmt.Sprintf(`
		SELECT
			EXTRACT(EPOCH FROM (%s))::bigint AS bucket_epoch,
			%s AS grp,
			COALESCE(SUM(s.delta_downloads), 0)::bigint AS delta
		FROM euler_stats.asset_snapshots s
		JOIN euler_stats.assets a ON a.asset_id = s.asset_id
		WHERE %s AND s.polled_at >= $%d AND s.polled_at <= $%d
		GROUP BY 1, 2
		ORDER BY 1 ASC
	`, bucketExpr, grpExpr, whereSQL, fromIdx, toIdx)

	rows, err := s.Pool.Query(ctx, qDelta, bucketArgs...)
	if err != nil {
		return resp, fmt.Errorf("timeseries delta: %w", err)
	}
	for rows.Next() {
		var epoch int64
		var grp string
		var delta int64
		if err := rows.Scan(&epoch, &grp, &delta); err != nil {
			rows.Close()
			return resp, err
		}
		if deltaMap[epoch] == nil {
			deltaMap[epoch] = make(map[string]int64)
		}
		deltaMap[epoch][grp] = delta
		seriesSet[grp] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return resp, err
	}
	rows.Close()

	// 2. Latest cumulative snapshot per bucket and group, preserving retired/deleted versions'
	// final counts so cumulative lines never drop when a workbook file is replaced.
	cumMap := make(map[int64]map[string]int64)
	qCum := fmt.Sprintf(`
		WITH filtered_assets AS (
			SELECT a.*
			FROM euler_stats.assets a
			WHERE %s
		),
		bucket_polls AS (
			SELECT
				EXTRACT(EPOCH FROM (%s))::bigint AS bucket_epoch,
				MAX(pr.id) AS last_poll_id,
				MAX(pr.polled_at) AS bucket_polled_at
			FROM euler_stats.poll_runs pr
			WHERE pr.status = 'ok' AND pr.polled_at >= $%d AND pr.polled_at <= $%d
			GROUP BY 1
		),
		active_in_poll AS (
			SELECT
				bp.bucket_epoch,
				%s AS grp,
				COALESCE(SUM(s.download_count), 0)::bigint AS cumulative
			FROM bucket_polls bp
			JOIN euler_stats.asset_snapshots s ON s.poll_run_id = bp.last_poll_id
			JOIN filtered_assets a ON a.asset_id = s.asset_id
			GROUP BY 1, 2
		),
		retired_before_poll AS (
			SELECT
				bp.bucket_epoch,
				%s AS grp,
				COALESCE(SUM(a.latest_download_count), 0)::bigint AS cumulative
			FROM bucket_polls bp
			JOIN filtered_assets a
			  ON a.is_active = FALSE
			 AND a.first_seen_at <= bp.bucket_polled_at
			 AND a.last_seen_at < bp.bucket_polled_at
			 AND NOT EXISTS (
				SELECT 1 FROM euler_stats.asset_snapshots s2
				WHERE s2.poll_run_id = bp.last_poll_id AND s2.asset_id = a.asset_id
			 )
			GROUP BY 1, 2
		)
		SELECT bucket_epoch, grp, SUM(cumulative)::bigint AS cumulative
		FROM (
			SELECT bucket_epoch, grp, cumulative FROM active_in_poll
			UNION ALL
			SELECT bucket_epoch, grp, cumulative FROM retired_before_poll
		) combined
		GROUP BY 1, 2
		ORDER BY 1 ASC
	`, whereSQL, pollBucketExpr, fromIdx, toIdx, grpExpr, grpExpr)

	cRows, err := s.Pool.Query(ctx, qCum, bucketArgs...)
	if err != nil {
		return resp, fmt.Errorf("timeseries cumulative: %w", err)
	}
	for cRows.Next() {
		var epoch int64
		var grp string
		var cum int64
		if err := cRows.Scan(&epoch, &grp, &cum); err != nil {
			cRows.Close()
			return resp, err
		}
		if cumMap[epoch] == nil {
			cumMap[epoch] = make(map[string]int64)
		}
		cumMap[epoch][grp] = cum
		seriesSet[grp] = struct{}{}
	}
	if err := cRows.Err(); err != nil {
		cRows.Close()
		return resp, err
	}
	cRows.Close()

	// Discover series keys consistently.
	for k := range seriesSet {
		resp.SeriesKeys = append(resp.SeriesKeys, k)
	}
	sortSeriesKeys(resp.SeriesKeys)

	// 3. Build continuous bucket spine and carry forward cumulative snapshots across gaps once tracking starts.
	spine := BuildBucketSpine(p.From, p.To, p.Granularity, p.Loc)
	var seenCum bool
	lastCumSeries := make(map[string]int64)
	var lastCumTotal int64

	for _, bStart := range spine {
		epoch := bStart.Unix()
		series := make(map[string]int64, len(resp.SeriesKeys))
		var totalDelta int64
		for _, k := range resp.SeriesKeys {
			v := deltaMap[epoch][k]
			series[k] = v
			totalDelta += v
		}

		cumSeries := make(map[string]int64, len(resp.SeriesKeys))
		var cumPtr *int64
		if cm, ok := cumMap[epoch]; ok {
			seenCum = true
			var t int64
			for _, k := range resp.SeriesKeys {
				v := cm[k]
				cumSeries[k] = v
				lastCumSeries[k] = v
				t += v
			}
			lastCumTotal = t
			val := t
			cumPtr = &val
		} else if seenCum {
			for _, k := range resp.SeriesKeys {
				cumSeries[k] = lastCumSeries[k]
			}
			val := lastCumTotal
			cumPtr = &val
		}

		resp.Buckets = append(resp.Buckets, TimeSeriesBucket{
			Timestamp:  bStart.In(p.Loc),
			Label:      FormatBucketLabel(bStart, p.Granularity, p.Loc),
			Delta:      totalDelta,
			Cumulative: cumPtr,
			Series:     series,
			CumSeries:  cumSeries,
		})
	}

	// 4. Activity Matrix (7 days x 24 hours in selected timezone) + 24h Hourly Profile.
	qMatrix := fmt.Sprintf(`
		WITH poll_totals AS (
			SELECT
				s.poll_run_id,
				extract(isodow from (s.polled_at AT TIME ZONE $%d))::int AS dow,
				extract(hour from (s.polled_at AT TIME ZONE $%d))::int AS hr,
				COALESCE(SUM(s.delta_downloads), 0)::bigint AS poll_delta
			FROM euler_stats.asset_snapshots s
			JOIN euler_stats.assets a ON a.asset_id = s.asset_id
			WHERE %s AND s.polled_at >= $%d AND s.polled_at <= $%d AND s.is_baseline = FALSE
			GROUP BY 1, 2, 3
		)
		SELECT
			dow,
			hr,
			COALESCE(SUM(poll_delta), 0)::bigint AS total_delta,
			COUNT(*)::int AS sample_count
		FROM poll_totals
		GROUP BY 1, 2
		ORDER BY 1, 2
	`, tzIdx, tzIdx, whereSQL, fromIdx, toIdx)

	matrixMap := make(map[[2]int]ActivityCell)
	hourTotals := make(map[int]int64)
	hourCounts := make(map[int]int)

	mRows, err := s.Pool.Query(ctx, qMatrix, matrixArgs...)
	if err != nil {
		return resp, fmt.Errorf("activity matrix: %w", err)
	}
	for mRows.Next() {
		var dow, hr, cnt int
		var tot int64
		if err := mRows.Scan(&dow, &hr, &tot, &cnt); err != nil {
			mRows.Close()
			return resp, err
		}
		avg := 0.0
		if cnt > 0 {
			avg = round2(float64(tot) / float64(cnt))
		}
		matrixMap[[2]int{dow, hr}] = ActivityCell{
			DayOfWeek:   dow,
			Hour:        hr,
			TotalDelta:  tot,
			SampleCount: cnt,
			AvgDelta:    avg,
		}
		hourTotals[hr] += tot
		hourCounts[hr] += cnt
	}
	if err := mRows.Err(); err != nil {
		mRows.Close()
		return resp, err
	}
	mRows.Close()

	for dow := 1; dow <= 7; dow++ {
		for hr := 0; hr < 24; hr++ {
			if c, ok := matrixMap[[2]int{dow, hr}]; ok {
				resp.ActivityMatrix = append(resp.ActivityMatrix, c)
			} else {
				resp.ActivityMatrix = append(resp.ActivityMatrix, ActivityCell{DayOfWeek: dow, Hour: hr})
			}
		}
	}
	for hr := 0; hr < 24; hr++ {
		avg := 0.0
		if hourCounts[hr] > 0 {
			avg = round2(float64(hourTotals[hr]) / float64(hourCounts[hr]))
		}
		resp.HourlyProfile = append(resp.HourlyProfile, HourProfilePoint{
			Hour:       hr,
			TotalDelta: hourTotals[hr],
			AvgDelta:   avg,
		})
	}

	return resp, nil
}

// GetAssets returns the leaderboard either aggregated per logical item across deleted/replaced
// versions (AssetModeItems) or as individual GitHub asset files (AssetModeFiles).
func (s *Store) GetAssets(ctx context.Context, p QueryParams, mode AssetMode, sortBy, sortDir string) ([]AssetRow, error) {
	whereSQL, whereArgs := buildAssetWhere(p, 1)
	fromIdx := len(whereArgs) + 1
	toIdx := len(whereArgs) + 2
	h24Idx := len(whereArgs) + 3
	d7Idx := len(whereArgs) + 4
	now := time.Now().UTC()
	args := append(append([]any{}, whereArgs...), p.From, p.To, now.Add(-24*time.Hour), now.Add(-7*24*time.Hour))

	orderCol := "all_time_downloads"
	switch strings.ToLower(strings.TrimSpace(sortBy)) {
	case "window_delta":
		orderCol = "window_delta"
	case "last_24h_delta":
		orderCol = "last_24h_delta"
	case "last_7d_delta":
		orderCol = "last_7d_delta"
	case "current_version_downloads":
		orderCol = "current_version_downloads"
	case "version_count":
		orderCol = "version_count"
	case "size_bytes":
		orderCol = "size_bytes"
	case "display_title":
		orderCol = "display_title"
	case "asset_updated_at":
		orderCol = "asset_updated_at"
	}
	dirSQL := "DESC"
	if strings.EqualFold(sortDir, "asc") {
		dirSQL = "ASC"
	}

	var q string
	if mode == AssetModeFiles {
		q = fmt.Sprintf(`
			WITH filtered AS (
				SELECT a.*
				FROM euler_stats.assets a
				WHERE %s
			),
			snap_agg AS (
				SELECT
					s.asset_id,
					COALESCE(SUM(CASE WHEN s.polled_at >= $%d AND s.polled_at <= $%d THEN s.delta_downloads ELSE 0 END), 0)::bigint AS window_delta,
					COALESCE(SUM(CASE WHEN s.polled_at >= $%d THEN s.delta_downloads ELSE 0 END), 0)::bigint AS last_24h_delta,
					COALESCE(SUM(CASE WHEN s.polled_at >= $%d THEN s.delta_downloads ELSE 0 END), 0)::bigint AS last_7d_delta
				FROM euler_stats.asset_snapshots s
				JOIN filtered f ON f.asset_id = s.asset_id
				GROUP BY s.asset_id
			)
			SELECT
				a.asset_id,
				a.release_tag,
				a.release_name,
				a.asset_name,
				a.item_key,
				a.display_title,
				a.category,
				a.subject,
				a.language,
				a.edition,
				a.author,
				a.license,
				a.pages,
				a.exercises,
				a.included_in_app,
				a.size_bytes,
				a.download_url,
				a.asset_created_at,
				a.asset_updated_at,
				a.first_seen_at,
				a.last_seen_at,
				a.is_active,
				1::int AS version_count,
				CASE WHEN a.is_active THEN a.latest_download_count ELSE 0 END AS current_version_downloads,
				a.latest_download_count AS all_time_downloads,
				COALESCE(sa.window_delta, 0)::bigint AS window_delta,
				COALESCE(sa.last_24h_delta, 0)::bigint AS last_24h_delta,
				COALESCE(sa.last_7d_delta, 0)::bigint AS last_7d_delta
			FROM filtered a
			LEFT JOIN snap_agg sa ON sa.asset_id = a.asset_id
			ORDER BY %s %s NULLS LAST, display_title ASC
		`, whereSQL, fromIdx, toIdx, h24Idx, d7Idx, orderCol, dirSQL)
	} else {
		q = fmt.Sprintf(`
			WITH filtered AS (
				SELECT a.*
				FROM euler_stats.assets a
				WHERE %s
			),
			snap_agg AS (
				SELECT
					s.asset_id,
					COALESCE(SUM(CASE WHEN s.polled_at >= $%d AND s.polled_at <= $%d THEN s.delta_downloads ELSE 0 END), 0)::bigint AS window_delta,
					COALESCE(SUM(CASE WHEN s.polled_at >= $%d THEN s.delta_downloads ELSE 0 END), 0)::bigint AS last_24h_delta,
					COALESCE(SUM(CASE WHEN s.polled_at >= $%d THEN s.delta_downloads ELSE 0 END), 0)::bigint AS last_7d_delta
				FROM euler_stats.asset_snapshots s
				JOIN filtered f ON f.asset_id = s.asset_id
				GROUP BY s.asset_id
			),
			ranked AS (
				SELECT
					a.*,
					ROW_NUMBER() OVER (
						PARTITION BY a.release_tag, a.item_key
						ORDER BY a.is_active DESC, a.last_seen_at DESC, a.asset_updated_at DESC NULLS LAST, a.asset_id DESC
					) AS rn
				FROM filtered a
			)
			SELECT
				rep.asset_id,
				rep.release_tag,
				rep.release_name,
				rep.asset_name,
				rep.item_key,
				rep.display_title,
				rep.category,
				rep.subject,
				rep.language,
				rep.edition,
				rep.author,
				rep.license,
				rep.pages,
				rep.exercises,
				rep.included_in_app,
				rep.size_bytes,
				rep.download_url,
				rep.asset_created_at,
				rep.asset_updated_at,
				MIN(a.first_seen_at) AS first_seen_at,
				MAX(a.last_seen_at) AS last_seen_at,
				BOOL_OR(a.is_active) AS is_active,
				COUNT(*)::int AS version_count,
				COALESCE(SUM(CASE WHEN a.is_active THEN a.latest_download_count ELSE 0 END), 0)::bigint AS current_version_downloads,
				COALESCE(SUM(a.latest_download_count), 0)::bigint AS all_time_downloads,
				COALESCE(SUM(COALESCE(sa.window_delta, 0)), 0)::bigint AS window_delta,
				COALESCE(SUM(COALESCE(sa.last_24h_delta, 0)), 0)::bigint AS last_24h_delta,
				COALESCE(SUM(COALESCE(sa.last_7d_delta, 0)), 0)::bigint AS last_7d_delta
			FROM filtered a
			JOIN ranked rep
			  ON rep.release_tag = a.release_tag
			 AND rep.item_key = a.item_key
			 AND rep.rn = 1
			LEFT JOIN snap_agg sa ON sa.asset_id = a.asset_id
			GROUP BY
				rep.asset_id, rep.release_tag, rep.release_name, rep.asset_name, rep.item_key,
				rep.display_title, rep.category, rep.subject, rep.language, rep.edition,
				rep.author, rep.license, rep.pages, rep.exercises, rep.included_in_app,
				rep.size_bytes, rep.download_url, rep.asset_created_at, rep.asset_updated_at
			ORDER BY %s %s NULLS LAST, display_title ASC
		`, whereSQL, fromIdx, toIdx, h24Idx, d7Idx, orderCol, dirSQL)
	}

	rows, err := s.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("get assets: %w", err)
	}
	defer rows.Close()

	var totalDownloads int64
	out := []AssetRow{}
	for rows.Next() {
		var r AssetRow
		if err := rows.Scan(
			&r.AssetID, &r.ReleaseTag, &r.ReleaseName, &r.AssetName, &r.ItemKey,
			&r.DisplayTitle, &r.Category, &r.Subject, &r.Language, &r.Edition,
			&r.Author, &r.License, &r.Pages, &r.Exercises, &r.IncludedInApp,
			&r.SizeBytes, &r.DownloadURL, &r.AssetCreatedAt, &r.AssetUpdatedAt,
			&r.FirstSeenAt, &r.LastSeenAt, &r.IsActive,
			&r.VersionCount, &r.CurrentVersionDownloads,
			&r.AllTimeDownloads, &r.WindowDelta, &r.Last24hDelta, &r.Last7dDelta,
		); err != nil {
			return nil, err
		}
		totalDownloads += r.AllTimeDownloads
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if totalDownloads > 0 {
		for i := range out {
			out[i].SharePct = round2((float64(out[i].AllTimeDownloads) / float64(totalDownloads)) * 100.0)
		}
	}
	return out, nil
}

// GetItemVersions returns every observed GitHub asset version for a logical (release_tag, item_key).
func (s *Store) GetItemVersions(ctx context.Context, releaseTag, itemKey string) ([]AssetRow, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT
			a.asset_id, a.release_tag, a.release_name, a.asset_name, a.item_key,
			a.display_title, a.category, a.subject, a.language, a.edition,
			a.author, a.license, a.pages, a.exercises, a.included_in_app,
			a.size_bytes, a.download_url, a.asset_created_at, a.asset_updated_at,
			a.first_seen_at, a.last_seen_at, a.is_active,
			1::int AS version_count,
			CASE WHEN a.is_active THEN a.latest_download_count ELSE 0 END,
			a.latest_download_count,
			0::bigint, 0::bigint, 0::bigint
		FROM euler_stats.assets a
		WHERE a.release_tag = $1 AND a.item_key = $2
		  AND (a.is_active OR a.latest_download_count > 0)
		ORDER BY a.is_active DESC, a.last_seen_at DESC, a.asset_id DESC
	`, releaseTag, itemKey)
	if err != nil {
		return nil, fmt.Errorf("get item versions: %w", err)
	}
	defer rows.Close()

	var totalDownloads int64
	out := []AssetRow{}
	for rows.Next() {
		var r AssetRow
		if err := rows.Scan(
			&r.AssetID, &r.ReleaseTag, &r.ReleaseName, &r.AssetName, &r.ItemKey,
			&r.DisplayTitle, &r.Category, &r.Subject, &r.Language, &r.Edition,
			&r.Author, &r.License, &r.Pages, &r.Exercises, &r.IncludedInApp,
			&r.SizeBytes, &r.DownloadURL, &r.AssetCreatedAt, &r.AssetUpdatedAt,
			&r.FirstSeenAt, &r.LastSeenAt, &r.IsActive,
			&r.VersionCount, &r.CurrentVersionDownloads,
			&r.AllTimeDownloads, &r.WindowDelta, &r.Last24hDelta, &r.Last7dDelta,
		); err != nil {
			return nil, err
		}
		totalDownloads += r.AllTimeDownloads
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if totalDownloads > 0 {
		for i := range out {
			out[i].SharePct = round2((float64(out[i].AllTimeDownloads) / float64(totalDownloads)) * 100.0)
		}
	}
	return out, nil
}

// GetPollRuns returns the latest collector execution records.
func (s *Store) GetPollRuns(ctx context.Context, limit int) ([]PollRunRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT
			id, polled_at, duration_ms, status, error_message,
			releases_count, assets_count, total_downloads, total_delta,
			is_baseline, rate_limit_remaining, rate_limit_reset_at
		FROM euler_stats.poll_runs
		ORDER BY polled_at DESC, id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []PollRunRow{}
	for rows.Next() {
		var r PollRunRow
		if err := rows.Scan(
			&r.ID, &r.PolledAt, &r.DurationMs, &r.Status, &r.ErrorMessage,
			&r.ReleasesCount, &r.AssetsCount, &r.TotalDownloads, &r.TotalDelta,
			&r.IsBaseline, &r.RateLimitRemaining, &r.RateLimitResetAt,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func sortSeriesKeys(keys []string) {
	priority := map[string]int{
		"curriculum": 1,
		"books":      2,
		"en":         1,
		"de":         2,
		"tablet":     1,
		"phone":      2,
		"all":        3,
		"other":      4,
		"total":      1,
	}
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			pi, pj := priority[keys[i]], priority[keys[j]]
			if pi == 0 {
				pi = 99
			}
			if pj == 0 {
				pj = 99
			}
			if pj < pi || (pj == pi && keys[j] < keys[i]) {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
