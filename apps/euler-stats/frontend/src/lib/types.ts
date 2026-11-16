export type Granularity = 'hour' | '6h' | 'day' | 'week' | 'month';
export type GroupBy = 'release' | 'language' | 'edition' | 'none';
export type RangePreset = '24h' | '48h' | '7d' | '30d' | '90d' | 'all' | 'custom';
export type MetricMode = 'delta' | 'cumulative';

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
