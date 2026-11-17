export type Granularity = 'hour' | '6h' | 'day' | 'week' | 'month';
export type GroupBy = 'release' | 'language' | 'edition' | 'none';
export type RangePreset = '24h' | '48h' | '7d' | '30d' | '90d' | 'all' | 'custom';
export type MetricMode = 'delta' | 'cumulative';
export type AssetMode = 'items' | 'files';

export type PlayDimFilterType =
  | ''
  | 'country'
  | 'device'
  | 'app_version'
  | 'os_version'
  | 'language'
  | 'carrier'
  | 'traffic_source';

export interface TimeRangeSelection {
  from: string;
  to: string;
  label: string;
}

export interface FilterState {
  granularity: Granularity;
  groupBy: GroupBy;
  range: RangePreset;
  from: string;
  to: string;
  tz: string;
  release: string;
  category: string;
  subject: string;
  language: string;
  edition: string;
  search: string;
  itemKey?: string;
  itemTitle?: string;
  hour: number | null;
  dow: number | null;
}

export interface PollerStatus {
  status: string;
  last_polled_at: string | null;
  last_success_at: string | null;
  first_polled_at: string | null;
  next_scheduled_at: string;
  total_polls: number;
  successful_polls: number;
  failed_polls: number;
  last_error: string;
  last_duration_ms: number;
  rate_limit_remaining: number | null;
  rate_limit_reset_at: string | null;
}

export interface BreakdownItem {
  key: string;
  all_time_downloads: number;
  window_delta: number;
  asset_count: number;
  total_bytes: number;
  share_pct: number;
}

export interface FilterOptions {
  releases: string[];
  categories: string[];
  subjects: string[];
  languages: string[];
  editions: string[];
}

export interface OverviewResponse {
  all_time: {
    total_downloads: number;
    baseline_downloads: number;
    tracked_delta: number;
    curriculum_downloads: number;
    books_downloads: number;
    total_assets: number;
    active_assets: number;
    total_bytes: number;
    tracking_days: number;
    latest_asset_updated_at: string | null;
  };
  window: {
    from: string;
    to: string;
    delta_downloads: number;
    prev_delta: number | null;
    change_pct: number | null;
    avg_per_hour: number;
    avg_per_day: number;
    active_assets_used: number;
  };
  poller: PollerStatus;
  filters: FilterOptions;
  by_release: BreakdownItem[];
  by_language: BreakdownItem[];
  by_edition: BreakdownItem[];
  by_subject: BreakdownItem[];
  by_category: BreakdownItem[];
}

export interface TimeSeriesBucket {
  timestamp: string;
  label: string;
  delta: number;
  cumulative: number | null;
  series: Record<string, number>;
  cum_series: Record<string, number>;
}

export interface ActivityCell {
  day_of_week: number;
  hour: number;
  total_delta: number;
  sample_count: number;
  avg_delta: number;
}

export interface HourProfilePoint {
  hour: number;
  total_delta: number;
  avg_delta: number;
}

export interface TimeSeriesResponse {
  granularity: Granularity;
  group_by: GroupBy;
  timezone: string;
  from: string;
  to: string;
  series_keys: string[];
  buckets: TimeSeriesBucket[];
  activity_matrix: ActivityCell[];
  hourly_profile: HourProfilePoint[];
}

export interface AssetRow {
  asset_id: number;
  release_tag: string;
  release_name: string;
  asset_name: string;
  item_key: string;
  display_title: string;
  category: string;
  subject: string;
  language: string;
  edition: string;
  author: string;
  license: string;
  pages: number;
  exercises: number;
  included_in_app: boolean;
  size_bytes: number;
  download_url: string;
  asset_created_at: string | null;
  asset_updated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  version_count: number;
  current_version_downloads: number;
  all_time_downloads: number;
  window_delta: number;
  last_24h_delta: number;
  last_7d_delta: number;
  share_pct: number;
}

export interface PollRunRow {
  id: number;
  polled_at: string;
  duration_ms: number;
  status: string;
  error_message: string;
  releases_count: number;
  assets_count: number;
  total_downloads: number;
  total_delta: number;
  is_baseline: boolean;
  rate_limit_remaining: number | null;
  rate_limit_reset_at: string | null;
}

export interface PlayDimensionRow {
  dimension_value: string;
  device_installs: number;
  device_uninstalls: number;
  device_upgrades: number;
  user_installs: number;
  user_uninstalls: number;
  active_devices: number;
  install_events: number;
  update_events: number;
  uninstall_events: number;
  store_visitors: number;
  store_acquisitions: number;
  conversion_rate: number;
  avg_rating: number | null;
  crashes: number;
  anrs: number;
}

export interface PlayTrafficSourceRow {
  traffic_source: string;
  search_term: string;
  utm_source: string;
  utm_campaign: string;
  visitors: number;
  acquisitions: number;
  conversion_rate: number;
}

export interface PlayTrackRow {
  package_name: string;
  track_name: string;
  release_name: string;
  status: string;
  version_codes: string;
  release_notes: string;
  updated_at: string;
}

export interface PlaySyncStatus {
  enabled: boolean;
  package_name: string;
  status: string;
  last_polled_at: string | null;
  last_success_at: string | null;
  next_scheduled_at: string;
  first_report_date: string | null;
  latest_report_date: string | null;
  latest_hourly_vitals: string | null;
  total_polls: number;
  successful_polls: number;
  synced_files_count: number;
  last_objects_seen: number;
  last_objects_updated: number;
  last_error: string;
  last_duration_ms: number;
}

export interface PlayOverviewResponse {
  sync: PlaySyncStatus;
  totals: {
    device_installs: number;
    device_uninstalls: number;
    device_upgrades: number;
    user_installs: number;
    user_uninstalls: number;
    active_devices: number;
    install_events: number;
    update_events: number;
    uninstall_events: number;
    store_visitors: number;
    store_acquisitions: number;
    conversion_rate: number;
    total_avg_rating: number | null;
    reviews_count: number;
    total_crashes: number;
    total_anrs: number;
    hourly_errors_total: number;
  };
  window: {
    from: string;
    to: string;
    device_installs: number;
    device_uninstalls: number;
    user_installs: number;
    user_uninstalls: number;
    install_events: number;
    update_events: number;
    store_visitors: number;
    store_acquisitions: number;
    conversion_rate: number;
    avg_rating: number | null;
    crashes: number;
    anrs: number;
  };
  tracks: PlayTrackRow[];
  by_country: PlayDimensionRow[];
  by_device: PlayDimensionRow[];
  by_app_version: PlayDimensionRow[];
  by_os_version: PlayDimensionRow[];
  by_language: PlayDimensionRow[];
  by_carrier: PlayDimensionRow[];
  by_traffic_source: PlayTrafficSourceRow[];
  countries: string[];
}

export interface PlayTimeSeriesPoint {
  timestamp: string;
  label: string;
  device_installs: number;
  device_uninstalls: number;
  user_installs: number;
  user_uninstalls: number;
  active_devices: number;
  install_events: number;
  update_events: number;
  store_visitors: number;
  store_acquisitions: number;
  conversion_rate: number;
  daily_avg_rating: number | null;
  total_avg_rating: number | null;
  crashes: number;
  anrs: number;
  distinct_users: number;
}

export interface PlayTimeSeriesResponse {
  granularity: Granularity;
  timezone: string;
  country: string;
  from: string;
  to: string;
  points: PlayTimeSeriesPoint[];
}

export interface PlayReviewView {
  review_key: string;
  app_version_code: string;
  app_version_name: string;
  reviewer_language: string;
  device: string;
  submitted_at: string;
  updated_at: string;
  star_rating: number;
  review_title: string;
  review_text: string;
  reply_at: string | null;
  reply_text: string;
}

export interface PlayVitalsSummaryRow {
  metric_set: string;
  aggregation_period: string;
  bucket_start: string;
  dimension_key: string;
  dimension_value: string;
  metrics: Record<string, number>;
}

export interface PlayPollRunRow {
  id: number;
  polled_at: string;
  duration_ms: number;
  status: string;
  error_message: string;
  gcs_objects_seen: number;
  gcs_objects_downloaded: number;
  gcs_rows_upserted: number;
  vitals_rows_upserted: number;
  reviews_upserted: number;
}

export interface NotificationSettings {
  enabled: boolean;
  recipient_email: string;
  crash_alerts_enabled: boolean;
  crash_min_version_code: number;
  include_anrs: boolean;
  crash_since: string;
  download_alerts_enabled: boolean;
  min_download_delta: number;
  updated_at: string;
}

export interface NotificationSettingsUpdate {
  enabled: boolean;
  recipient_email: string;
  crash_alerts_enabled: boolean;
  crash_min_version_code: number;
  include_anrs: boolean;
  download_alerts_enabled: boolean;
  min_download_delta: number;
  reset_crash_baseline: boolean;
}

export interface SMTPStatus {
  configured: boolean;
  host: string;
  port: string;
  username: string;
  from: string;
  default_recipient: string;
}

export interface NotificationLogEntry {
  id: number;
  created_at: string;
  event_type: string;
  recipient: string;
  subject: string;
  body_text: string;
  status: string;
  error_message: string;
}

export interface NotificationStatusResponse {
  settings: NotificationSettings;
  smtp: SMTPStatus;
  admin_protected: boolean;
  logs: NotificationLogEntry[];
}
