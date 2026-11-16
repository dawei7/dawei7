package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PlayDimensionRow aggregates Play metrics across a chosen dimension value (country, device, etc.).
type PlayDimensionRow struct {
	DimensionValue  string   `json:"dimension_value"`
	DeviceInstalls  int64    `json:"device_installs"`
	DeviceUninstalls int64   `json:"device_uninstalls"`
	DeviceUpgrades  int64    `json:"device_upgrades"`
	UserInstalls    int64    `json:"user_installs"`
	UserUninstalls  int64    `json:"user_uninstalls"`
	ActiveDevices   int64    `json:"active_devices"`
	InstallEvents   int64    `json:"install_events"`
	UpdateEvents    int64    `json:"update_events"`
	UninstallEvents int64    `json:"uninstall_events"`
	StoreVisitors   int64    `json:"store_visitors"`
	StoreAcquisitions int64  `json:"store_acquisitions"`
	ConversionRate  float64  `json:"conversion_rate"`
	AvgRating       *float64 `json:"avg_rating"`
	Crashes         int64    `json:"crashes"`
	ANRs            int64    `json:"anrs"`
}

// PlayTrafficSourceRow aggregates store_performance_traffic_source rows.
type PlayTrafficSourceRow struct {
	TrafficSource  string  `json:"traffic_source"`
	SearchTerm     string  `json:"search_term"`
	UTMSource      string  `json:"utm_source"`
	UTMCampaign    string  `json:"utm_campaign"`
	Visitors       int64   `json:"visitors"`
	Acquisitions   int64   `json:"acquisitions"`
	ConversionRate float64 `json:"conversion_rate"`
}

// PlaySyncStatus summarizes Play Store collector health.
type PlaySyncStatus struct {
	Enabled             bool       `json:"enabled"`
	PackageName         string     `json:"package_name"`
	Status              string     `json:"status"`
	LastPolledAt        *time.Time `json:"last_polled_at"`
	LastSuccessAt       *time.Time `json:"last_success_at"`
	NextScheduledAt     time.Time  `json:"next_scheduled_at"`
	FirstReportDate     *string    `json:"first_report_date"`
	LatestReportDate    *string    `json:"latest_report_date"`
	LatestHourlyVitals  *time.Time `json:"latest_hourly_vitals"`
	TotalPolls          int        `json:"total_polls"`
	SuccessfulPolls     int        `json:"successful_polls"`
	SyncedFilesCount    int        `json:"synced_files_count"`
	LastObjectsSeen     int        `json:"last_objects_seen"`
	LastObjectsUpdated  int        `json:"last_objects_updated"`
	LastError           string     `json:"last_error"`
	LastDurationMs      int        `json:"last_duration_ms"`
}

// PlayOverviewResponse bundles all Play KPIs, dimensions, tracks, and sync status.
type PlayOverviewResponse struct {
	Sync   PlaySyncStatus `json:"sync"`
	Totals struct {
		DeviceInstalls    int64    `json:"device_installs"`
		DeviceUninstalls  int64    `json:"device_uninstalls"`
		DeviceUpgrades    int64    `json:"device_upgrades"`
		UserInstalls      int64    `json:"user_installs"`
		UserUninstalls    int64    `json:"user_uninstalls"`
		ActiveDevices     int64    `json:"active_devices"`
		InstallEvents     int64    `json:"install_events"`
		UpdateEvents      int64    `json:"update_events"`
		UninstallEvents   int64    `json:"uninstall_events"`
		StoreVisitors     int64    `json:"store_visitors"`
		StoreAcquisitions int64    `json:"store_acquisitions"`
		ConversionRate    float64  `json:"conversion_rate"`
		TotalAvgRating    *float64 `json:"total_avg_rating"`
		ReviewsCount      int      `json:"reviews_count"`
		TotalCrashes      int64    `json:"total_crashes"`
		TotalANRs         int64    `json:"total_anrs"`
		HourlyErrorsTotal int64    `json:"hourly_errors_total"`
	} `json:"totals"`
	Window struct {
		From              string   `json:"from"`
		To                string   `json:"to"`
		DeviceInstalls    int64    `json:"device_installs"`
		DeviceUninstalls  int64    `json:"device_uninstalls"`
		UserInstalls      int64    `json:"user_installs"`
		UserUninstalls    int64    `json:"user_uninstalls"`
		InstallEvents     int64    `json:"install_events"`
		UpdateEvents      int64    `json:"update_events"`
		StoreVisitors     int64    `json:"store_visitors"`
		StoreAcquisitions int64    `json:"store_acquisitions"`
		ConversionRate    float64  `json:"conversion_rate"`
		AvgRating         *float64 `json:"avg_rating"`
		Crashes           int64    `json:"crashes"`
		ANRs              int64    `json:"anrs"`
	} `json:"window"`
	Tracks          []PlayTrackRow         `json:"tracks"`
	ByCountry       []PlayDimensionRow     `json:"by_country"`
	ByDevice        []PlayDimensionRow     `json:"by_device"`
	ByAppVersion    []PlayDimensionRow     `json:"by_app_version"`
	ByOSVersion     []PlayDimensionRow     `json:"by_os_version"`
	ByLanguage      []PlayDimensionRow     `json:"by_language"`
	ByCarrier       []PlayDimensionRow     `json:"by_carrier"`
	ByTrafficSource []PlayTrafficSourceRow `json:"by_traffic_source"`
	Countries       []string               `json:"countries"`
}

// PlayTimeSeriesPoint represents one day/week/month/hour bucket for Play Store charts.
type PlayTimeSeriesPoint struct {
	Timestamp         time.Time `json:"timestamp"`
	Label             string    `json:"label"`
	DeviceInstalls    int64     `json:"device_installs"`
	DeviceUninstalls  int64     `json:"device_uninstalls"`
	UserInstalls      int64     `json:"user_installs"`
	UserUninstalls    int64     `json:"user_uninstalls"`
	ActiveDevices     int64     `json:"active_devices"`
	InstallEvents     int64     `json:"install_events"`
	UpdateEvents      int64     `json:"update_events"`
	StoreVisitors     int64     `json:"store_visitors"`
	StoreAcquisitions int64     `json:"store_acquisitions"`
	ConversionRate    float64   `json:"conversion_rate"`
	DailyAvgRating    *float64  `json:"daily_avg_rating"`
	TotalAvgRating    *float64  `json:"total_avg_rating"`
	Crashes           int64     `json:"crashes"`
	ANRs              int64     `json:"anrs"`
	DistinctUsers     int64     `json:"distinct_users"`
}

// PlayTimeSeriesResponse wraps Play Store chart points.
type PlayTimeSeriesResponse struct {
	Granularity Granularity           `json:"granularity"`
	Timezone    string                `json:"timezone"`
	Country     string                `json:"country"`
	From        time.Time             `json:"from"`
	To          time.Time             `json:"to"`
	Points      []PlayTimeSeriesPoint `json:"points"`
}

// PlayReviewView serializes a Play review for the UI.
type PlayReviewView struct {
	ReviewKey        string     `json:"review_key"`
	AppVersionCode   string     `json:"app_version_code"`
	AppVersionName   string     `json:"app_version_name"`
	ReviewerLanguage string     `json:"reviewer_language"`
	Device           string     `json:"device"`
	SubmittedAt      time.Time  `json:"submitted_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	StarRating       int        `json:"star_rating"`
	ReviewTitle      string     `json:"review_title"`
	ReviewText       string     `json:"review_text"`
	ReplyAt          *time.Time `json:"reply_at"`
	ReplyText        string     `json:"reply_text"`
}

// PlayVitalsSummaryRow represents one Reporting API vitals record.
type PlayVitalsSummaryRow struct {
	MetricSet         string             `json:"metric_set"`
	AggregationPeriod string             `json:"aggregation_period"`
	BucketStart       time.Time          `json:"bucket_start"`
	DimensionKey      string             `json:"dimension_key"`
	DimensionValue    string             `json:"dimension_value"`
	Metrics           map[string]float64 `json:"metrics"`
}

// PlayPollRunRow represents a Play hourly sync log entry.
type PlayPollRunRow struct {
	ID                   int64     `json:"id"`
	PolledAt             time.Time `json:"polled_at"`
	DurationMs           int       `json:"duration_ms"`
	Status               string    `json:"status"`
	ErrorMessage         string    `json:"error_message"`
	GCSObjectsSeen       int       `json:"gcs_objects_seen"`
	GCSObjectsDownloaded int       `json:"gcs_objects_downloaded"`
	GCSRowsUpserted      int       `json:"gcs_rows_upserted"`
	VitalsRowsUpserted   int       `json:"vitals_rows_upserted"`
	ReviewsUpserted      int       `json:"reviews_upserted"`
}

// NextPlayTopOfHour aligns Play Store hourly sync to :01:05 UTC (1 minute after GitHub poll).
func NextPlayTopOfHour(now time.Time) time.Time {
	return now.UTC().Truncate(time.Hour).Add(time.Hour).Add(65 * time.Second)
}

// PlayDateBounds returns earliest and latest report_date stored in play_installs_daily.
func (s *Store) PlayDateBounds(ctx context.Context) (*time.Time, *time.Time, error) {
	var minD, maxD *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT MIN(report_date)::timestamptz, MAX(report_date)::timestamptz
		FROM euler_stats.play_installs_daily
	`).Scan(&minD, &maxD)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}
	return minD, maxD, nil
}

// GetPlayOverview returns Play Store KPIs, breakdowns across all dimensions, tracks, and sync status.
func (s *Store) GetPlayOverview(
	ctx context.Context,
	pkgName string,
	fromDate, toDate time.Time,
	country string,
	playEnabled bool,
) (PlayOverviewResponse, error) {
	var out PlayOverviewResponse
	out.Window.From = fromDate.Format("2006-01-02")
	out.Window.To = toDate.Format("2006-01-02")

	syncStatus, err := s.getPlaySyncStatus(ctx, pkgName, playEnabled)
	if err != nil {
		return out, fmt.Errorf("play sync status: %w", err)
	}
	out.Sync = syncStatus

	dimType := "overview"
	dimVal := ""
	if country != "" && !strings.EqualFold(country, "all") {
		dimType = "country"
		dimVal = country
	}

	// 1. All-time totals from daily reports.
	err = s.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(daily_device_installs), 0)::bigint,
			COALESCE(SUM(daily_device_uninstalls), 0)::bigint,
			COALESCE(SUM(daily_device_upgrades), 0)::bigint,
			COALESCE(SUM(daily_user_installs), 0)::bigint,
			COALESCE(SUM(daily_user_uninstalls), 0)::bigint,
			COALESCE(SUM(install_events), 0)::bigint,
			COALESCE(SUM(update_events), 0)::bigint,
			COALESCE(SUM(uninstall_events), 0)::bigint
		FROM euler_stats.play_installs_daily
		WHERE package_name = $1 AND dimension_type = $2 AND dimension_value = $3
	`, pkgName, dimType, dimVal).Scan(
		&out.Totals.DeviceInstalls, &out.Totals.DeviceUninstalls, &out.Totals.DeviceUpgrades,
		&out.Totals.UserInstalls, &out.Totals.UserUninstalls,
		&out.Totals.InstallEvents, &out.Totals.UpdateEvents, &out.Totals.UninstallEvents,
	)
	if err != nil {
		return out, fmt.Errorf("play totals installs: %w", err)
	}

	// Latest active devices count.
	_ = s.Pool.QueryRow(ctx, `
		SELECT active_device_installs
		FROM euler_stats.play_installs_daily
		WHERE package_name = $1 AND dimension_type = $2 AND dimension_value = $3
		ORDER BY report_date DESC
		LIMIT 1
	`, pkgName, dimType, dimVal).Scan(&out.Totals.ActiveDevices)

	// Window installs.
	err = s.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(daily_device_installs), 0)::bigint,
			COALESCE(SUM(daily_device_uninstalls), 0)::bigint,
			COALESCE(SUM(daily_user_installs), 0)::bigint,
			COALESCE(SUM(daily_user_uninstalls), 0)::bigint,
			COALESCE(SUM(install_events), 0)::bigint,
			COALESCE(SUM(update_events), 0)::bigint
		FROM euler_stats.play_installs_daily
		WHERE package_name = $1 AND dimension_type = $2 AND dimension_value = $3
		  AND report_date >= $4::date AND report_date <= $5::date
	`, pkgName, dimType, dimVal, fromDate, toDate).Scan(
		&out.Window.DeviceInstalls, &out.Window.DeviceUninstalls,
		&out.Window.UserInstalls, &out.Window.UserUninstalls,
		&out.Window.InstallEvents, &out.Window.UpdateEvents,
	)
	if err != nil {
		return out, fmt.Errorf("play window installs: %w", err)
	}

	// Store performance (all-time & window).
	storeWhere := "package_name = $1 AND dimension_type = 'country'"
	storeArgs := []any{pkgName}
	if dimType == "country" {
		storeWhere += " AND dimension_value = $2"
		storeArgs = append(storeArgs, dimVal)
	}
	err = s.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT COALESCE(SUM(visitors), 0)::bigint, COALESCE(SUM(acquisitions), 0)::bigint
		FROM euler_stats.play_store_performance_daily
		WHERE %s
	`, storeWhere), storeArgs...).Scan(&out.Totals.StoreVisitors, &out.Totals.StoreAcquisitions)
	if err != nil {
		return out, fmt.Errorf("play totals store perf: %w", err)
	}
	if out.Totals.StoreVisitors > 0 {
		out.Totals.ConversionRate = round2((float64(out.Totals.StoreAcquisitions) / float64(out.Totals.StoreVisitors)) * 100.0)
	}

	winStoreArgs := append(append([]any{}, storeArgs...), fromDate, toDate)
	fIdx, tIdx := len(storeArgs)+1, len(storeArgs)+2
	err = s.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT COALESCE(SUM(visitors), 0)::bigint, COALESCE(SUM(acquisitions), 0)::bigint
		FROM euler_stats.play_store_performance_daily
		WHERE %s AND report_date >= $%d::date AND report_date <= $%d::date
	`, storeWhere, fIdx, tIdx), winStoreArgs...).Scan(&out.Window.StoreVisitors, &out.Window.StoreAcquisitions)
	if err != nil {
		return out, fmt.Errorf("play window store perf: %w", err)
	}
	if out.Window.StoreVisitors > 0 {
		out.Window.ConversionRate = round2((float64(out.Window.StoreAcquisitions) / float64(out.Window.StoreVisitors)) * 100.0)
	}

	// Ratings & reviews count.
	_ = s.Pool.QueryRow(ctx, `
		SELECT total_avg_rating
		FROM euler_stats.play_ratings_daily
		WHERE package_name = $1 AND dimension_type = $2 AND dimension_value = $3 AND total_avg_rating IS NOT NULL
		ORDER BY report_date DESC
		LIMIT 1
	`, pkgName, dimType, dimVal).Scan(&out.Totals.TotalAvgRating)

	_ = s.Pool.QueryRow(ctx, `
		SELECT AVG(daily_avg_rating)
		FROM euler_stats.play_ratings_daily
		WHERE package_name = $1 AND dimension_type = $2 AND dimension_value = $3
		  AND report_date >= $4::date AND report_date <= $5::date
		  AND daily_avg_rating IS NOT NULL AND daily_avg_rating > 0
	`, pkgName, dimType, dimVal, fromDate, toDate).Scan(&out.Window.AvgRating)

	_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM euler_stats.play_reviews WHERE package_name = $1`, pkgName).
		Scan(&out.Totals.ReviewsCount)

	// Crashes (overview CSV + Reporting API hourly error count).
	_ = s.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(daily_crashes), 0)::bigint, COALESCE(SUM(daily_anrs), 0)::bigint
		FROM euler_stats.play_crashes_daily
		WHERE package_name = $1 AND dimension_type = 'overview'
	`, pkgName).Scan(&out.Totals.TotalCrashes, &out.Totals.TotalANRs)

	_ = s.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(daily_crashes), 0)::bigint, COALESCE(SUM(daily_anrs), 0)::bigint
		FROM euler_stats.play_crashes_daily
		WHERE package_name = $1 AND dimension_type = 'overview'
		  AND report_date >= $2::date AND report_date <= $3::date
	`, pkgName, fromDate, toDate).Scan(&out.Window.Crashes, &out.Window.ANRs)

	_ = s.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM((metrics_json->>'errorReportCount')::double precision), 0)::bigint
		FROM euler_stats.play_vitals_timeseries
		WHERE package_name = $1 AND metric_set = 'errorCountMetricSet'
		  AND aggregation_period = 'HOURLY' AND dimension_key = 'reportType'
	`, pkgName).Scan(&out.Totals.HourlyErrorsTotal)

	// Tracks.
	if out.Tracks, err = s.queryPlayTracks(ctx, pkgName); err != nil {
		return out, err
	}

	// Dimensional breakdowns (computed in selected window or all-time? Window totals + latest active!).
	if out.ByCountry, err = s.queryPlayDimension(ctx, pkgName, "country", fromDate, toDate); err != nil {
		return out, err
	}
	if out.ByDevice, err = s.queryPlayDimension(ctx, pkgName, "device", fromDate, toDate); err != nil {
		return out, err
	}
	if out.ByAppVersion, err = s.queryPlayDimension(ctx, pkgName, "app_version", fromDate, toDate); err != nil {
		return out, err
	}
	if out.ByOSVersion, err = s.queryPlayDimension(ctx, pkgName, "os_version", fromDate, toDate); err != nil {
		return out, err
	}
	if out.ByLanguage, err = s.queryPlayDimension(ctx, pkgName, "language", fromDate, toDate); err != nil {
		return out, err
	}
	if out.ByCarrier, err = s.queryPlayDimension(ctx, pkgName, "carrier", fromDate, toDate); err != nil {
		return out, err
	}
	if out.ByTrafficSource, err = s.queryPlayTrafficSources(ctx, pkgName, fromDate, toDate); err != nil {
		return out, err
	}

	out.Countries = []string{}
	cRows, err := s.Pool.Query(ctx, `
		SELECT DISTINCT dimension_value
		FROM euler_stats.play_installs_daily
		WHERE package_name = $1 AND dimension_type = 'country' AND dimension_value <> ''
		ORDER BY 1
	`, pkgName)
	if err == nil {
		defer cRows.Close()
		for cRows.Next() {
			var c string
			if err := cRows.Scan(&c); err == nil {
				out.Countries = append(out.Countries, c)
			}
		}
	}

	return out, nil
}

func (s *Store) getPlaySyncStatus(ctx context.Context, pkgName string, enabled bool) (PlaySyncStatus, error) {
	ps := PlaySyncStatus{
		Enabled:         enabled,
		PackageName:     pkgName,
		Status:          "unconfigured",
		NextScheduledAt: NextPlayTopOfHour(time.Now()),
	}
	if enabled {
		ps.Status = "initializing"
	}

	_ = s.Pool.QueryRow(ctx, `
		SELECT MIN(report_date)::text, MAX(report_date)::text
		FROM euler_stats.play_installs_daily
		WHERE package_name = $1
	`, pkgName).Scan(&ps.FirstReportDate, &ps.LatestReportDate)

	_ = s.Pool.QueryRow(ctx, `
		SELECT MAX(bucket_start)
		FROM euler_stats.play_vitals_timeseries
		WHERE package_name = $1 AND aggregation_period = 'HOURLY'
	`, pkgName).Scan(&ps.LatestHourlyVitals)

	_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM euler_stats.play_sync_files`).Scan(&ps.SyncedFilesCount)

	_ = s.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE status = 'ok')::int,
			MAX(polled_at) FILTER (WHERE status = 'ok')
		FROM euler_stats.play_poll_runs
	`).Scan(&ps.TotalPolls, &ps.SuccessfulPolls, &ps.LastSuccessAt)

	var status, errMsg string
	var polledAt time.Time
	var durMs, seen, dl int
	err := s.Pool.QueryRow(ctx, `
		SELECT status, polled_at, duration_ms, error_message, gcs_objects_seen, gcs_objects_downloaded
		FROM euler_stats.play_poll_runs
		ORDER BY polled_at DESC, id DESC
		LIMIT 1
	`).Scan(&status, &polledAt, &durMs, &errMsg, &seen, &dl)
	if err == nil {
		ps.Status = status
		ps.LastPolledAt = &polledAt
		ps.LastDurationMs = durMs
		ps.LastError = errMsg
		ps.LastObjectsSeen = seen
		ps.LastObjectsUpdated = dl
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ps, err
	}
	return ps, nil
}

func (s *Store) queryPlayTracks(ctx context.Context, pkgName string) ([]PlayTrackRow, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT package_name, track_name, release_name, status, version_codes, release_notes, updated_at
		FROM euler_stats.play_tracks
		WHERE package_name = $1
		ORDER BY CASE track_name
			WHEN 'production' THEN 1
			WHEN 'beta' THEN 2
			WHEN 'alpha' THEN 3
			ELSE 4 END, track_name
	`, pkgName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlayTrackRow{}
	for rows.Next() {
		var r PlayTrackRow
		if err := rows.Scan(&r.PackageName, &r.TrackName, &r.ReleaseName, &r.Status, &r.VersionCodes, &r.ReleaseNotes, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) queryPlayDimension(
	ctx context.Context,
	pkgName, dimType string,
	fromDate, toDate time.Time,
) ([]PlayDimensionRow, error) {
	q := `
		WITH inst AS (
			SELECT
				dimension_value,
				COALESCE(SUM(daily_device_installs), 0)::bigint AS dev_inst,
				COALESCE(SUM(daily_device_uninstalls), 0)::bigint AS dev_uninst,
				COALESCE(SUM(daily_device_upgrades), 0)::bigint AS dev_upg,
				COALESCE(SUM(daily_user_installs), 0)::bigint AS usr_inst,
				COALESCE(SUM(daily_user_uninstalls), 0)::bigint AS usr_uninst,
				COALESCE(SUM(install_events), 0)::bigint AS inst_ev,
				COALESCE(SUM(update_events), 0)::bigint AS upd_ev,
				COALESCE(SUM(uninstall_events), 0)::bigint AS uninst_ev
			FROM euler_stats.play_installs_daily
			WHERE package_name = $1 AND dimension_type = $2
			  AND report_date >= $3::date AND report_date <= $4::date
			GROUP BY dimension_value
		),
		latest_active AS (
			SELECT DISTINCT ON (dimension_value)
				dimension_value,
				active_device_installs
			FROM euler_stats.play_installs_daily
			WHERE package_name = $1 AND dimension_type = $2
			  AND report_date <= $4::date
			ORDER BY dimension_value, report_date DESC
		),
		perf AS (
			SELECT
				dimension_value,
				COALESCE(SUM(visitors), 0)::bigint AS visitors,
				COALESCE(SUM(acquisitions), 0)::bigint AS acquisitions
			FROM euler_stats.play_store_performance_daily
			WHERE package_name = $1 AND dimension_type = $2
			  AND report_date >= $3::date AND report_date <= $4::date
			GROUP BY dimension_value
		),
		rat AS (
			SELECT DISTINCT ON (dimension_value)
				dimension_value,
				total_avg_rating
			FROM euler_stats.play_ratings_daily
			WHERE package_name = $1 AND dimension_type = $2
			  AND report_date <= $4::date AND total_avg_rating IS NOT NULL
			ORDER BY dimension_value, report_date DESC
		),
		cr AS (
			SELECT
				dimension_value,
				COALESCE(SUM(daily_crashes), 0)::bigint AS crashes,
				COALESCE(SUM(daily_anrs), 0)::bigint AS anrs
			FROM euler_stats.play_crashes_daily
			WHERE package_name = $1 AND dimension_type = $2
			  AND report_date >= $3::date AND report_date <= $4::date
			GROUP BY dimension_value
		),
		keys AS (
			SELECT dimension_value FROM inst
			UNION
			SELECT dimension_value FROM perf
			UNION
			SELECT dimension_value FROM cr
		)
		SELECT
			k.dimension_value,
			COALESCE(i.dev_inst, 0), COALESCE(i.dev_uninst, 0), COALESCE(i.dev_upg, 0),
			COALESCE(i.usr_inst, 0), COALESCE(i.usr_uninst, 0),
			COALESCE(la.active_device_installs, 0),
			COALESCE(i.inst_ev, 0), COALESCE(i.upd_ev, 0), COALESCE(i.uninst_ev, 0),
			COALESCE(p.visitors, 0), COALESCE(p.acquisitions, 0),
			r.total_avg_rating,
			COALESCE(c.crashes, 0), COALESCE(c.anrs, 0)
		FROM keys k
		LEFT JOIN inst i ON i.dimension_value = k.dimension_value
		LEFT JOIN latest_active la ON la.dimension_value = k.dimension_value
		LEFT JOIN perf p ON p.dimension_value = k.dimension_value
		LEFT JOIN rat r ON r.dimension_value = k.dimension_value
		LEFT JOIN cr c ON c.dimension_value = k.dimension_value
		ORDER BY COALESCE(i.dev_inst, 0) DESC, COALESCE(la.active_device_installs, 0) DESC, COALESCE(p.acquisitions, 0) DESC, k.dimension_value ASC
	`
	rows, err := s.Pool.Query(ctx, q, pkgName, dimType, fromDate, toDate)
	if err != nil {
		return nil, fmt.Errorf("play dim %s: %w", dimType, err)
	}
	defer rows.Close()

	out := []PlayDimensionRow{}
	for rows.Next() {
		var r PlayDimensionRow
		if err := rows.Scan(
			&r.DimensionValue,
			&r.DeviceInstalls, &r.DeviceUninstalls, &r.DeviceUpgrades,
			&r.UserInstalls, &r.UserUninstalls,
			&r.ActiveDevices,
			&r.InstallEvents, &r.UpdateEvents, &r.UninstallEvents,
			&r.StoreVisitors, &r.StoreAcquisitions,
			&r.AvgRating,
			&r.Crashes, &r.ANRs,
		); err != nil {
			return nil, err
		}
		if r.StoreVisitors > 0 {
			r.ConversionRate = round2((float64(r.StoreAcquisitions) / float64(r.StoreVisitors)) * 100.0)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) queryPlayTrafficSources(
	ctx context.Context,
	pkgName string,
	fromDate, toDate time.Time,
) ([]PlayTrafficSourceRow, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT
			dimension_value, search_term, utm_source, utm_campaign,
			COALESCE(SUM(visitors), 0)::bigint,
			COALESCE(SUM(acquisitions), 0)::bigint
		FROM euler_stats.play_store_performance_daily
		WHERE package_name = $1 AND dimension_type = 'traffic_source'
		  AND report_date >= $2::date AND report_date <= $3::date
		GROUP BY dimension_value, search_term, utm_source, utm_campaign
		ORDER BY SUM(acquisitions) DESC, SUM(visitors) DESC, dimension_value ASC
	`, pkgName, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlayTrafficSourceRow{}
	for rows.Next() {
		var r PlayTrafficSourceRow
		if err := rows.Scan(&r.TrafficSource, &r.SearchTerm, &r.UTMSource, &r.UTMCampaign, &r.Visitors, &r.Acquisitions); err != nil {
			return nil, err
		}
		if r.Visitors > 0 {
			r.ConversionRate = round2((float64(r.Acquisitions) / float64(r.Visitors)) * 100.0)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetPlayTimeSeries returns continuous time-series buckets at hour (vitals) or day/week/month (installs/store/ratings/crashes).
func (s *Store) GetPlayTimeSeries(
	ctx context.Context,
	pkgName string,
	gran Granularity,
	from, to time.Time,
	loc *time.Location,
	tzName, country string,
) (PlayTimeSeriesResponse, error) {
	resp := PlayTimeSeriesResponse{
		Granularity: gran,
		Timezone:    tzName,
		Country:     country,
		From:        from,
		To:          to,
		Points:      []PlayTimeSeriesPoint{},
	}

	if gran == GranularityHour {
		alignedFrom := AlignBucketStart(from, GranularityHour, loc)
		resp.From = alignedFrom

		rows, err := s.Pool.Query(ctx, `
			SELECT
				EXTRACT(EPOCH FROM date_trunc('hour', bucket_start))::bigint,
				dimension_value,
				COALESCE((metrics_json->>'errorReportCount')::double precision, 0)::bigint,
				COALESCE((metrics_json->>'distinctUsers')::double precision, 0)::bigint
			FROM euler_stats.play_vitals_timeseries
			WHERE package_name = $1 AND metric_set = 'errorCountMetricSet'
			  AND aggregation_period = 'HOURLY' AND dimension_key = 'reportType'
			  AND bucket_start >= $2 AND bucket_start <= $3
		`, pkgName, alignedFrom, to)
		if err != nil {
			return resp, fmt.Errorf("play hourly vitals: %w", err)
		}
		defer rows.Close()

		type hv struct {
			crashes, anrs, users int64
		}
		byEpoch := make(map[int64]*hv)
		for rows.Next() {
			var ep, cnt, usr int64
			var rType string
			if err := rows.Scan(&ep, &rType, &cnt, &usr); err != nil {
				return resp, err
			}
			cell := byEpoch[ep]
			if cell == nil {
				cell = &hv{}
				byEpoch[ep] = cell
			}
			if strings.EqualFold(rType, "ANR") {
				cell.anrs += cnt
			} else {
				cell.crashes += cnt
			}
			if usr > cell.users {
				cell.users = usr
			}
		}
		if err := rows.Err(); err != nil {
			return resp, err
		}

		for _, b := range BuildBucketSpine(alignedFrom, to, GranularityHour, loc) {
			pt := PlayTimeSeriesPoint{
				Timestamp: b.In(loc),
				Label:     FormatBucketLabel(b, GranularityHour, loc),
			}
			if v := byEpoch[b.Unix()]; v != nil {
				pt.Crashes = v.crashes
				pt.ANRs = v.anrs
				pt.DistinctUsers = v.users
			}
			resp.Points = append(resp.Points, pt)
		}
		return resp, nil
	}

	// Daily / Weekly / Monthly aggregation from Play Console GCS daily tables.
	if gran == Granularity6Hour {
		gran = GranularityDay
		resp.Granularity = GranularityDay
	}

	dimType := "overview"
	dimVal := ""
	if country != "" && !strings.EqualFold(country, "all") {
		dimType = "country"
		dimVal = country
	}

	// Date buckets are calendar dates in report_date (DATE column). Align in UTC/date space cleanly.
	fromDate := time.Date(from.In(loc).Year(), from.In(loc).Month(), from.In(loc).Day(), 0, 0, 0, 0, loc)
	toDate := time.Date(to.In(loc).Year(), to.In(loc).Month(), to.In(loc).Day(), 0, 0, 0, 0, loc)
	alignedStart := AlignBucketStart(fromDate, gran, loc)

	truncUnit := "day"
	if gran == GranularityWeek {
		truncUnit = "week"
	} else if gran == GranularityMonth {
		truncUnit = "month"
	}

	// Aggregate installs.
	byBucket := make(map[string]*PlayTimeSeriesPoint)
	ensure := func(key string) *PlayTimeSeriesPoint {
		p := byBucket[key]
		if p == nil {
			p = &PlayTimeSeriesPoint{}
			byBucket[key] = p
		}
		return p
	}

	iRows, err := s.Pool.Query(ctx, fmt.Sprintf(`
		SELECT
			to_char(date_trunc('%s', report_date::timestamp), 'YYYY-MM-DD'),
			COALESCE(SUM(daily_device_installs), 0)::bigint,
			COALESCE(SUM(daily_device_uninstalls), 0)::bigint,
			COALESCE(SUM(daily_user_installs), 0)::bigint,
			COALESCE(SUM(daily_user_uninstalls), 0)::bigint,
			COALESCE(MAX(active_device_installs), 0)::bigint,
			COALESCE(SUM(install_events), 0)::bigint,
			COALESCE(SUM(update_events), 0)::bigint
		FROM euler_stats.play_installs_daily
		WHERE package_name = $1 AND dimension_type = $2 AND dimension_value = $3
		  AND report_date >= $4::date AND report_date <= $5::date
		GROUP BY 1
	`, truncUnit), pkgName, dimType, dimVal, alignedStart.Format("2006-01-02"), toDate.Format("2006-01-02"))
	if err != nil {
		return resp, fmt.Errorf("play ts installs: %w", err)
	}
	for iRows.Next() {
		var key string
		var di, du, ui, uu, act, ie, ue int64
		if err := iRows.Scan(&key, &di, &du, &ui, &uu, &act, &ie, &ue); err != nil {
			iRows.Close()
			return resp, err
		}
		pt := ensure(key)
		pt.DeviceInstalls = di
		pt.DeviceUninstalls = du
		pt.UserInstalls = ui
		pt.UserUninstalls = uu
		pt.ActiveDevices = act
		pt.InstallEvents = ie
		pt.UpdateEvents = ue
	}
	iRows.Close()

	// Store performance (when overview -> sum across country rows).
	spWhere := "package_name = $1 AND dimension_type = 'country'"
	spArgs := []any{pkgName, alignedStart.Format("2006-01-02"), toDate.Format("2006-01-02")}
	if dimType == "country" {
		spWhere += " AND dimension_value = $4"
		spArgs = append(spArgs, dimVal)
	}
	spRows, err := s.Pool.Query(ctx, fmt.Sprintf(`
		SELECT
			to_char(date_trunc('%s', report_date::timestamp), 'YYYY-MM-DD'),
			COALESCE(SUM(visitors), 0)::bigint,
			COALESCE(SUM(acquisitions), 0)::bigint
		FROM euler_stats.play_store_performance_daily
		WHERE %s AND report_date >= $2::date AND report_date <= $3::date
		GROUP BY 1
	`, truncUnit, spWhere), spArgs...)
	if err != nil {
		return resp, fmt.Errorf("play ts store perf: %w", err)
	}
	for spRows.Next() {
		var key string
		var vis, acq int64
		if err := spRows.Scan(&key, &vis, &acq); err != nil {
			spRows.Close()
			return resp, err
		}
		pt := ensure(key)
		pt.StoreVisitors = vis
		pt.StoreAcquisitions = acq
		if vis > 0 {
			pt.ConversionRate = round2((float64(acq) / float64(vis)) * 100.0)
		}
	}
	spRows.Close()

	// Ratings.
	rRows, err := s.Pool.Query(ctx, fmt.Sprintf(`
		SELECT
			to_char(date_trunc('%s', report_date::timestamp), 'YYYY-MM-DD'),
			AVG(NULLIF(daily_avg_rating, 0)),
			MAX(total_avg_rating)
		FROM euler_stats.play_ratings_daily
		WHERE package_name = $1 AND dimension_type = $2 AND dimension_value = $3
		  AND report_date >= $4::date AND report_date <= $5::date
		GROUP BY 1
	`, truncUnit), pkgName, dimType, dimVal, alignedStart.Format("2006-01-02"), toDate.Format("2006-01-02"))
	if err != nil {
		return resp, fmt.Errorf("play ts ratings: %w", err)
	}
	for rRows.Next() {
		var key string
		var dAvg, tAvg *float64
		if err := rRows.Scan(&key, &dAvg, &tAvg); err != nil {
			rRows.Close()
			return resp, err
		}
		pt := ensure(key)
		pt.DailyAvgRating = dAvg
		pt.TotalAvgRating = tAvg
	}
	rRows.Close()

	// Crashes (overview CSV only has overview/app_version/device/os_version, not country).
	if dimType == "overview" {
		cRows, err := s.Pool.Query(ctx, fmt.Sprintf(`
			SELECT
				to_char(date_trunc('%s', report_date::timestamp), 'YYYY-MM-DD'),
				COALESCE(SUM(daily_crashes), 0)::bigint,
				COALESCE(SUM(daily_anrs), 0)::bigint
			FROM euler_stats.play_crashes_daily
			WHERE package_name = $1 AND dimension_type = 'overview'
			  AND report_date >= $2::date AND report_date <= $3::date
			GROUP BY 1
		`, truncUnit), pkgName, alignedStart.Format("2006-01-02"), toDate.Format("2006-01-02"))
		if err != nil {
			return resp, fmt.Errorf("play ts crashes: %w", err)
		}
		for cRows.Next() {
			var key string
			var cr, anr int64
			if err := cRows.Scan(&key, &cr, &anr); err != nil {
				cRows.Close()
				return resp, err
			}
			pt := ensure(key)
			pt.Crashes = cr
			pt.ANRs = anr
		}
		cRows.Close()
	}

	// Build continuous calendar bucket spine.
	spine := BuildBucketSpine(alignedStart, toDate, gran, loc)
	for _, b := range spine {
		key := b.In(loc).Format("2006-01-02")
		pt := PlayTimeSeriesPoint{
			Timestamp: b.In(loc),
			Label:     FormatBucketLabel(b, gran, loc),
		}
		if existing := byBucket[key]; existing != nil {
			pt.DeviceInstalls = existing.DeviceInstalls
			pt.DeviceUninstalls = existing.DeviceUninstalls
			pt.UserInstalls = existing.UserInstalls
			pt.UserUninstalls = existing.UserUninstalls
			pt.ActiveDevices = existing.ActiveDevices
			pt.InstallEvents = existing.InstallEvents
			pt.UpdateEvents = existing.UpdateEvents
			pt.StoreVisitors = existing.StoreVisitors
			pt.StoreAcquisitions = existing.StoreAcquisitions
			pt.ConversionRate = existing.ConversionRate
			pt.DailyAvgRating = existing.DailyAvgRating
			pt.TotalAvgRating = existing.TotalAvgRating
			pt.Crashes = existing.Crashes
			pt.ANRs = existing.ANRs
		}
		resp.Points = append(resp.Points, pt)
	}
	return resp, nil
}

// GetPlayReviews returns all downloaded Google Play reviews newest-first.
func (s *Store) GetPlayReviews(ctx context.Context, pkgName string, limit int) ([]PlayReviewView, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT
			review_key, app_version_code, app_version_name, reviewer_language,
			device, submitted_at, updated_at, star_rating, review_title,
			review_text, reply_at, reply_text
		FROM euler_stats.play_reviews
		WHERE package_name = $1
		ORDER BY submitted_at DESC
		LIMIT $2
	`, pkgName, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlayReviewView{}
	for rows.Next() {
		var r PlayReviewView
		if err := rows.Scan(
			&r.ReviewKey, &r.AppVersionCode, &r.AppVersionName, &r.ReviewerLanguage,
			&r.Device, &r.SubmittedAt, &r.UpdatedAt, &r.StarRating, &r.ReviewTitle,
			&r.ReviewText, &r.ReplyAt, &r.ReplyText,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetPlayVitals returns Reporting API metric rows (newest first).
func (s *Store) GetPlayVitals(ctx context.Context, pkgName string, limit int) ([]PlayVitalsSummaryRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 150
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT metric_set, aggregation_period, bucket_start, dimension_key, dimension_value, metrics_json::text
		FROM euler_stats.play_vitals_timeseries
		WHERE package_name = $1
		ORDER BY bucket_start DESC, metric_set ASC
		LIMIT $2
	`, pkgName, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlayVitalsSummaryRow{}
	for rows.Next() {
		var r PlayVitalsSummaryRow
		var rawJSON string
		if err := rows.Scan(&r.MetricSet, &r.AggregationPeriod, &r.BucketStart, &r.DimensionKey, &r.DimensionValue, &rawJSON); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(rawJSON), &r.Metrics)
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetPlayPollRuns returns recent Play Store hourly collector logs.
func (s *Store) GetPlayPollRuns(ctx context.Context, limit int) ([]PlayPollRunRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT
			id, polled_at, duration_ms, status, error_message,
			gcs_objects_seen, gcs_objects_downloaded, gcs_rows_upserted,
			vitals_rows_upserted, reviews_upserted
		FROM euler_stats.play_poll_runs
		ORDER BY polled_at DESC, id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlayPollRunRow{}
	for rows.Next() {
		var r PlayPollRunRow
		if err := rows.Scan(
			&r.ID, &r.PolledAt, &r.DurationMs, &r.Status, &r.ErrorMessage,
			&r.GCSObjectsSeen, &r.GCSObjectsDownloaded, &r.GCSRowsUpserted,
			&r.VitalsRowsUpserted, &r.ReviewsUpserted,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
