import type {
  AssetMode,
  AssetRow,
  FilterState,
  Granularity,
  NotificationLogEntry,
  NotificationSettings,
  NotificationSettingsUpdate,
  NotificationStatusResponse,
  OverviewResponse,
  PlayDimFilterType,
  PlayOverviewResponse,
  PlayPollRunRow,
  PlayReviewView,
  PlayTimeSeriesResponse,
  PlayVitalsSummaryRow,
  PollRunRow,
  RangePreset,
  TimeSeriesResponse,
} from './types';

function buildQuery(
  f: FilterState,
  extra?: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  params.set('granularity', f.granularity);
  params.set('group_by', f.groupBy);
  params.set('tz', f.tz);

  if (f.range === 'custom') {
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
  } else {
    params.set('range', f.range);
  }

  if (f.release) params.set('release', f.release);
  if (f.category) params.set('category', f.category);
  if (f.subject) params.set('subject', f.subject);
  if (f.language) params.set('language', f.language);
  if (f.edition) params.set('edition', f.edition);
  if (f.search.trim()) params.set('q', f.search.trim());
  if (f.itemKey) params.set('item_key', f.itemKey);
  if (f.hour !== null && f.hour !== undefined) params.set('hour', String(f.hour));
  if (f.dow !== null && f.dow !== undefined) params.set('dow', String(f.dow));

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== '') {
        params.set(k, String(v));
      }
    }
  }

  return params.toString();
}

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function fetchOverview(f: FilterState, signal?: AbortSignal): Promise<OverviewResponse> {
  return fetchJSON<OverviewResponse>(`/api/overview?${buildQuery(f)}`, signal);
}

export function fetchTimeSeries(
  f: FilterState,
  extra?: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<TimeSeriesResponse> {
  return fetchJSON<TimeSeriesResponse>(`/api/timeseries?${buildQuery(f, extra)}`, signal);
}

export async function fetchAssets(
  f: FilterState,
  mode: AssetMode,
  sort: string,
  dir: 'asc' | 'desc',
  signal?: AbortSignal,
): Promise<AssetRow[]> {
  const data = await fetchJSON<{ assets: AssetRow[] }>(
    `/api/assets?${buildQuery(f, { mode, sort, dir })}`,
    signal,
  );
  return data.assets ?? [];
}

export async function fetchItemVersions(
  releaseTag: string,
  itemKey: string,
  signal?: AbortSignal,
): Promise<AssetRow[]> {
  const params = new URLSearchParams({ release: releaseTag, item_key: itemKey });
  const data = await fetchJSON<{ versions: AssetRow[] }>(`/api/item-versions?${params}`, signal);
  return data.versions ?? [];
}

export async function fetchPolls(limit = 60, signal?: AbortSignal): Promise<PollRunRow[]> {
  const data = await fetchJSON<{ polls: PollRunRow[] }>(`/api/polls?limit=${limit}`, signal);
  return data.polls ?? [];
}

export function csvExportURL(
  kind: 'timeseries' | 'assets',
  f: FilterState,
  mode: AssetMode = 'items',
): string {
  return `/api/export.csv?${buildQuery(f, { type: kind, mode })}`;
}

export interface PlayFilterState {
  granularity: Granularity;
  range: RangePreset;
  from: string;
  to: string;
  tz: string;
  dimType: PlayDimFilterType;
  dimValue: string;
}

function buildPlayQuery(
  f: PlayFilterState,
  extra?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  params.set('granularity', f.granularity);
  params.set('tz', f.tz);
  if (f.range === 'custom') {
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
  } else {
    params.set('range', f.range);
  }
  if (f.dimType && f.dimValue) {
    params.set('dim_type', f.dimType);
    params.set('dim_value', f.dimValue);
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return params.toString();
}

export function fetchPlayOverview(
  f: PlayFilterState,
  signal?: AbortSignal,
): Promise<PlayOverviewResponse> {
  return fetchJSON<PlayOverviewResponse>(`/api/play/overview?${buildPlayQuery(f)}`, signal);
}

export function fetchPlayTimeSeries(
  f: PlayFilterState,
  signal?: AbortSignal,
): Promise<PlayTimeSeriesResponse> {
  return fetchJSON<PlayTimeSeriesResponse>(`/api/play/timeseries?${buildPlayQuery(f)}`, signal);
}

export async function fetchPlayReviews(limit = 200, signal?: AbortSignal): Promise<PlayReviewView[]> {
  const data = await fetchJSON<{ reviews: PlayReviewView[] }>(`/api/play/reviews?limit=${limit}`, signal);
  return data.reviews ?? [];
}

export async function fetchPlayVitals(limit = 150, signal?: AbortSignal): Promise<PlayVitalsSummaryRow[]> {
  const data = await fetchJSON<{ vitals: PlayVitalsSummaryRow[] }>(`/api/play/vitals?limit=${limit}`, signal);
  return data.vitals ?? [];
}

export async function fetchPlayPolls(limit = 60, signal?: AbortSignal): Promise<PlayPollRunRow[]> {
  const data = await fetchJSON<{ polls: PlayPollRunRow[] }>(`/api/play/polls?limit=${limit}`, signal);
  return data.polls ?? [];
}

export function playCsvExportURL(kind: 'timeseries' | 'countries', f: PlayFilterState): string {
  return `/api/play/export.csv?${buildPlayQuery(f, { type: kind })}`;
}

export function fetchNotifications(limit = 40, signal?: AbortSignal): Promise<NotificationStatusResponse> {
  return fetchJSON<NotificationStatusResponse>(`/api/notifications?limit=${limit}`, signal);
}

export async function updateNotificationSettings(
  upd: NotificationSettingsUpdate,
  adminToken: string,
): Promise<NotificationSettings> {
  const res = await fetch('/api/notifications/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken.trim()}`,
    },
    body: JSON.stringify(upd),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<NotificationSettings>;
}

export async function sendTestNotification(
  adminToken: string,
): Promise<{ entry: NotificationLogEntry; error?: string }> {
  const res = await fetch('/api/notifications/test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken.trim()}`,
    },
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok && !body.entry) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body as { entry: NotificationLogEntry; error?: string };
}
