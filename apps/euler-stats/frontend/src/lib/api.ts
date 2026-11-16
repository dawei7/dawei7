import type {
  AssetMode,
  AssetRow,
  FilterState,
  OverviewResponse,
  PollRunRow,
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
