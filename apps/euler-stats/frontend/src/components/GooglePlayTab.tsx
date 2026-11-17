import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPlayOverview,
  fetchPlayReviews,
  fetchPlayTimeSeries,
  fetchPlayVitals,
  playCsvExportURL,
  type PlayFilterState,
} from '../lib/api';
import type {
  Granularity,
  PlayDimensionRow,
  PlayDimFilterType,
  PlayOverviewResponse,
  PlayReviewView,
  PlayTimeSeriesResponse,
  PlayVitalsSummaryRow,
  RangePreset,
  TimeRangeSelection,
} from '../lib/types';
import {
  countryName,
  formatCountdown,
  formatNumber,
  formatRelativeTime,
  formatTimestamp,
} from '../lib/format';
import {
  buildBucketSelection,
  formatDateInTz,
  isBucketInSelection,
} from '../lib/chartSelection';
import { useBucketBrush } from '../lib/useBucketBrush';
import { SelectionsBar, type SelectionChip } from './SelectionsBar';

type PlayMetricMode = 'installs' | 'active' | 'funnel' | 'ratings' | 'vitals';
type PlayDimTab =
  | 'country'
  | 'device'
  | 'app_version'
  | 'os_version'
  | 'language'
  | 'carrier'
  | 'traffic_source';
type PlayBarMetric = 'device_installs' | 'active_devices' | 'store_visitors' | 'crashes';

const PLAY_DIM_LABELS: Record<Exclude<PlayDimFilterType, ''>, string> = {
  country: 'Country',
  device: 'Device',
  app_version: 'App Version',
  os_version: 'Android OS',
  language: 'Language',
  carrier: 'Carrier',
  traffic_source: 'Traffic Source',
};

function formatPlayDimValue(dimType: PlayDimFilterType, val: string): string {
  if (!val) return '(Not specified)';
  if (dimType === 'country') return countryName(val);
  if (dimType === 'app_version') return `vCode ${val}`;
  return val;
}

interface GooglePlayTabProps {
  defaultTz: string;
  tzOptions: string[];
  refreshTick: number;
  onOpenPolls?: () => void;
}

export function GooglePlayTab({
  defaultTz,
  tzOptions,
  refreshTick,
  onOpenPolls,
}: GooglePlayTabProps) {
  const [filters, setFilters] = useState<PlayFilterState>(() => ({
    granularity: 'day',
    range: '30d',
    from: '',
    to: '',
    tz: defaultTz,
    dimType: '',
    dimValue: '',
  }));
  const [chartTime, setChartTime] = useState<TimeRangeSelection | null>(null);
  const [metricMode, setMetricMode] = useState<PlayMetricMode>('installs');
  const [dimTab, setDimTab] = useState<PlayDimTab>('country');
  const [barMetric, setBarMetric] = useState<PlayBarMetric>('device_installs');
  const [trafficBarMetric, setTrafficBarMetric] = useState<'acquisitions' | 'visitors'>('acquisitions');
  const [dimSearch, setDimSearch] = useState('');
  const [starFilter, setStarFilter] = useState<number | null>(null);

  const [overview, setOverview] = useState<PlayOverviewResponse | null>(null);
  const [ts, setTs] = useState<PlayTimeSeriesResponse | null>(null);
  const [reviews, setReviews] = useState<PlayReviewView[]>([]);
  const [vitals, setVitals] = useState<PlayVitalsSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const effectiveFilters = useMemo<PlayFilterState>(
    () =>
      chartTime
        ? { ...filters, range: 'custom', from: chartTime.from, to: chartTime.to }
        : filters,
    [filters, chartTime],
  );

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Keep PlayChart rendered across the full selected range so Qlik green vs grey bar states stay interactive.
  useEffect(() => {
    const ac = new AbortController();
    fetchPlayTimeSeries(filters, ac.signal)
      .then((series) => setTs(series))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load Play Store series');
      });
    return () => ac.abort();
  }, [filters, refreshTick]);

  // Overview KPIs and Breakdowns dynamically cross-filter to chartTime + selected dimension.
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      fetchPlayOverview(effectiveFilters, ac.signal),
      fetchPlayReviews(200, ac.signal),
      fetchPlayVitals(150, ac.signal),
    ])
      .then(([ov, rev, vit]) => {
        setOverview(ov);
        setReviews(rev);
        setVitals(vit);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load Play Store stats');
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [effectiveFilters, refreshTick]);

  const handleGranularity = (g: Granularity) => {
    setChartTime(null);
    setFilters((prev) => {
      let nextRange = prev.range;
      if (g === 'hour') {
        setMetricMode('vitals');
        if (prev.range === '90d' || prev.range === 'all') nextRange = '30d';
      } else if (metricMode === 'vitals') {
        setMetricMode('installs');
      }
      return { ...prev, granularity: g, range: nextRange };
    });
  };

  const handleMetricMode = (m: PlayMetricMode) => {
    setMetricMode(m);
    if (m === 'vitals' && filters.granularity !== 'hour') {
      return;
    }
    if (m !== 'vitals' && filters.granularity === 'hour') {
      setChartTime(null);
      setFilters((prev) => ({ ...prev, granularity: 'day' }));
    }
  };

  const togglePlayDim = (nextType: Exclude<PlayDimFilterType, ''>, nextValue: string) => {
    if (!nextValue) return;
    const clearing = filters.dimType === nextType && filters.dimValue === nextValue;
    if (!clearing && nextType === 'traffic_source') {
      setMetricMode('funnel');
      if (filters.granularity === 'hour') {
        setChartTime(null);
        setFilters((prev) => ({ ...prev, granularity: 'day', dimType: nextType, dimValue: nextValue }));
        return;
      }
    }
    setFilters((prev) =>
      clearing ? { ...prev, dimType: '', dimValue: '' } : { ...prev, dimType: nextType, dimValue: nextValue },
    );
  };

  const toggleStarFilter = (stars: number) => {
    setStarFilter((prev) => (prev === stars ? null : stars));
  };

  const toggleBucketTimestamp = (isoTs: string, granOverride?: Granularity) => {
    const gran = granOverride ?? filters.granularity;
    const label = gran === 'hour' ? formatTimestamp(isoTs, filters.tz) : formatDateInTz(isoTs, filters.tz);
    const sel = buildBucketSelection([{ timestamp: isoTs, label }], 0, 0, gran, filters.tz, gran !== 'hour');
    if (!sel) return;
    setChartTime((prev) => (prev && prev.from === sel.from && prev.to === sel.to ? null : sel));
  };

  const clearAllSelections = () => {
    setChartTime(null);
    setStarFilter(null);
    setFilters((prev) => ({ ...prev, dimType: '', dimValue: '' }));
  };

  const selectionChips: SelectionChip[] = useMemo(() => {
    const chips: SelectionChip[] = [];
    if (chartTime) {
      chips.push({
        key: 'chartTime',
        label: filters.granularity === 'hour' ? 'Hour Slice' : 'Date Slice',
        value: chartTime.label,
        onClear: () => setChartTime(null),
      });
    }
    if (filters.dimType && filters.dimValue) {
      chips.push({
        key: 'playDim',
        label: PLAY_DIM_LABELS[filters.dimType],
        value: formatPlayDimValue(filters.dimType, filters.dimValue),
        onClear: () => setFilters((p) => ({ ...p, dimType: '', dimValue: '' })),
      });
    }
    if (starFilter !== null) {
      chips.push({
        key: 'starRating',
        label: 'Review Rating',
        value: `${starFilter} ★`,
        onClear: () => setStarFilter(null),
      });
    }
    return chips;
  }, [chartTime, filters.granularity, filters.dimType, filters.dimValue, starFilter]);

  const dimRows: PlayDimensionRow[] = useMemo(() => {
    if (!overview) return [];
    const base =
      dimTab === 'country'
        ? overview.by_country
        : dimTab === 'device'
          ? overview.by_device
          : dimTab === 'app_version'
            ? overview.by_app_version
            : dimTab === 'os_version'
              ? overview.by_os_version
              : dimTab === 'language'
                ? overview.by_language
                : overview.by_carrier;

    const q = dimSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => {
      const label = dimTab === 'country' ? countryName(r.dimension_value) : r.dimension_value;
      return label.toLowerCase().includes(q) || r.dimension_value.toLowerCase().includes(q);
    });
  }, [overview, dimTab, dimSearch]);

  const topChartRows = useMemo(() => {
    const sorted = [...dimRows].sort((a, b) => b[barMetric] - a[barMetric]);
    return sorted.slice(0, 10);
  }, [dimRows, barMetric]);

  const filteredTrafficRows = useMemo(() => {
    if (!overview) return [];
    const q = dimSearch.trim().toLowerCase();
    if (!q) return overview.by_traffic_source;
    return overview.by_traffic_source.filter(
      (r) =>
        r.traffic_source.toLowerCase().includes(q) ||
        r.search_term.toLowerCase().includes(q) ||
        r.utm_source.toLowerCase().includes(q) ||
        r.utm_campaign.toLowerCase().includes(q),
    );
  }, [overview, dimSearch]);

  const topTrafficBars = useMemo(() => {
    const map = new Map<string, { traffic_source: string; visitors: number; acquisitions: number }>();
    for (const r of filteredTrafficRows) {
      const key = r.traffic_source || '(Not specified)';
      const cur = map.get(key) ?? { traffic_source: r.traffic_source, visitors: 0, acquisitions: 0 };
      cur.visitors += r.visitors;
      cur.acquisitions += r.acquisitions;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b[trafficBarMetric] - a[trafficBarMetric])
      .slice(0, 10);
  }, [filteredTrafficRows, trafficBarMetric]);

  const reviewsBeforeStar = useMemo(() => {
    return reviews.filter((rev) => {
      if (chartTime && !isBucketInSelection(rev.submitted_at, chartTime, filters.tz)) {
        return false;
      }
      if (filters.dimType === 'app_version' && filters.dimValue) {
        if (rev.app_version_code !== filters.dimValue) return false;
      }
      if (filters.dimType === 'device' && filters.dimValue) {
        if (rev.device !== filters.dimValue) return false;
      }
      if (filters.dimType === 'language' && filters.dimValue) {
        const lang = rev.reviewer_language.toLowerCase().split(/[-_]/)[0];
        const target = filters.dimValue.toLowerCase().split(/[-_]/)[0];
        if (
          rev.reviewer_language.toLowerCase() !== filters.dimValue.toLowerCase() &&
          lang !== target
        ) {
          return false;
        }
      }
      return true;
    });
  }, [reviews, chartTime, filters.tz, filters.dimType, filters.dimValue]);

  const starCounts = useMemo(() => {
    const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviewsBeforeStar) {
      if (counts[r.star_rating] !== undefined) counts[r.star_rating] += 1;
    }
    return counts;
  }, [reviewsBeforeStar]);

  const filteredReviews = useMemo(() => {
    if (starFilter === null) return reviewsBeforeStar;
    return reviewsBeforeStar.filter((r) => r.star_rating === starFilter);
  }, [reviewsBeforeStar, starFilter]);

  const filteredVitals = useMemo(() => {
    return vitals.filter((v) => {
      if (chartTime) {
        if (filters.granularity === 'hour') {
          if (!isBucketInSelection(v.bucket_start, chartTime, filters.tz)) return false;
        } else {
          const vDay = formatDateInTz(v.bucket_start, filters.tz);
          if (vDay < chartTime.from || vDay > chartTime.to) return false;
        }
      }
      if (filters.dimType === 'app_version' && filters.dimValue) {
        if (
          v.dimension_key === 'reportType,versionCode' &&
          !v.dimension_value.endsWith(`,${filters.dimValue}`)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [vitals, chartTime, filters.granularity, filters.tz, filters.dimType, filters.dimValue]);

  const prodTrack = overview?.tracks.find((t) => t.track_name === 'production');
  const canClickActiveDimTab = true;
  const dimHasInstalls = filters.dimType !== 'traffic_source';
  const dimHasStorePerf =
    !filters.dimType || filters.dimType === 'country' || filters.dimType === 'traffic_source';
  const dimHasCrashes =
    !filters.dimType ||
    filters.dimType === 'app_version' ||
    filters.dimType === 'device' ||
    filters.dimType === 'os_version';
  const dimHasHourlyVitals = !filters.dimType || filters.dimType === 'app_version';
  const resolveReviewLangFilter = (revLang: string): string => {
    if (!revLang || !overview) return revLang;
    const base = revLang.toLowerCase().split(/[-_]/)[0];
    const match = overview.by_language.find(
      (l) =>
        l.dimension_value.toLowerCase() === revLang.toLowerCase() ||
        l.dimension_value.toLowerCase().split(/[-_]/)[0] === base,
    );
    return match ? match.dimension_value : revLang;
  };

  return (
    <div className="space-y-5">
      {/* Control Bar */}
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium shrink-0">
              Granularity
            </span>
            <div className="inline-flex overflow-x-auto no-scrollbar max-w-full rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
              {(
                [
                  ['day', 'Daily'],
                  ['week', 'Weekly'],
                  ['month', 'Monthly'],
                  ['hour', 'Hourly (Vitals)'],
                ] as [Granularity, string][]
              ).map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => handleGranularity(g)}
                  className={`whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 sm:py-1 cursor-pointer transition-colors ${
                    filters.granularity === g
                      ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                      : 'text-[#4a4338] hover:text-[#1c1914]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium shrink-0">
              Window
            </span>
            <div className="inline-flex overflow-x-auto no-scrollbar max-w-full rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
              {(['7d', '30d', '90d', 'all', 'custom'] as RangePreset[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setChartTime(null);
                    setFilters((p) => ({ ...p, range: r }));
                  }}
                  className={`whitespace-nowrap shrink-0 rounded-full px-2.5 py-1.5 sm:py-1 cursor-pointer transition-colors ${
                    filters.range === r
                      ? 'bg-[#8d6b32] text-[#fffcf6] font-medium'
                      : 'text-[#4a4338] hover:text-[#1c1914]'
                  }`}
                >
                  {r === 'all' ? 'All' : r === 'custom' ? 'Custom' : r}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs w-full lg:w-auto">
            <select
              value={filters.dimType === 'country' ? filters.dimValue : ''}
              onChange={(e) =>
                setFilters((p) => ({
                  ...p,
                  dimType: e.target.value ? 'country' : '',
                  dimValue: e.target.value,
                }))
              }
              className="flex-1 sm:flex-none rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
            >
              <option value="">All Countries</option>
              {(overview?.countries ?? []).map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </select>

            <select
              value={filters.tz}
              onChange={(e) => {
                setChartTime(null);
                setFilters((p) => ({ ...p, tz: e.target.value }));
              }}
              className="flex-1 sm:flex-none rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
            >
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>
                  TZ: {tz}
                </option>
              ))}
            </select>

            <a
              href={playCsvExportURL('timeseries', effectiveFilters)}
              className="rounded-full border border-[#d5cdb8] bg-[#f3eee4] px-3 py-1.5 font-medium text-[#1c1914] hover:border-[#8d6b32] transition-colors whitespace-nowrap"
            >
              Export CSV
            </a>
          </div>
        </div>

        {filters.range === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
            <label className="flex items-center gap-1.5 text-[#4a4338]">
              From:
              <input
                type="date"
                value={filters.from}
                onChange={(e) => {
                  setChartTime(null);
                  setFilters((p) => ({ ...p, from: e.target.value }));
                }}
                className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-sm sm:text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[#4a4338]">
              To:
              <input
                type="date"
                value={filters.to}
                onChange={(e) => {
                  setChartTime(null);
                  setFilters((p) => ({ ...p, to: e.target.value }));
                }}
                className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-sm sm:text-xs"
              />
            </label>
          </div>
        )}

        <div className="text-[11px] text-[#6e6558] pt-1 border-t border-[#ece5d7]">
          <strong>Google Play Cadence:</strong> Daily reports are polled hourly via GCS ETag checks with zero duplication. Crash/ANR &amp; active-user counts from Reporting API also support <strong>hourly</strong> buckets.
        </div>
      </div>

      <SelectionsBar
        chips={selectionChips}
        onClearAll={clearAllSelections}
        hint="Click or drag any chart bar, click legend series, or press any breakdown bar/row below to cross-filter like Qlik."
      />

      {error && (
        <div className="rounded-xl border border-[#a4513a]/40 bg-[#a4513a]/10 px-4 py-3 text-sm text-[#a4513a]">
          {error}
        </div>
      )}

      {loading && !overview ? (
        <div className="py-16 text-center text-sm text-[#6e6558]">
          Loading Google Play Store analytics for com.mathn.tablet...
        </div>
      ) : overview ? (
        <>
          {!overview.sync.enabled && (
            <div className="rounded-xl border border-[#8d6b32]/40 bg-[#8d6b32]/10 px-4 py-3 text-xs text-[#4a4338]">
              Google Play service account key is not mounted yet on this server instance.
            </div>
          )}

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-4">
            <div
              onClick={() => dimHasInstalls && handleMetricMode('installs')}
              className={`rounded-2xl border bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs transition-all ${
                dimHasInstalls ? 'cursor-pointer hover:border-[#1e4636]/55' : ''
              } ${
                metricMode === 'installs' || metricMode === 'active'
                  ? 'border-[#1e4636] ring-1 ring-[#1e4636]/25'
                  : 'border-[#d5cdb8]'
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <span>Installs</span>
                {filters.dimType && filters.dimValue ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilters((p) => ({ ...p, dimType: '', dimValue: '' }));
                    }}
                    title="Clear dimension filter"
                    className="rounded-full bg-[#1e4636] px-2 py-0.5 text-[10px] sm:text-[11px] text-[#faf7f1] normal-case truncate max-w-[115px] sm:max-w-[160px] cursor-pointer hover:bg-[#143028]"
                  >
                    {formatPlayDimValue(filters.dimType, filters.dimValue)} ✕
                  </button>
                ) : (
                  <span className="rounded-full bg-[#e7e0d2] px-2 py-0.5 text-[10px] sm:text-[11px] text-[#4a4338] normal-case">
                    All
                  </span>
                )}
              </div>
              <div className="mt-1.5 sm:mt-2 flex items-baseline justify-between gap-2">
                <div className="text-2xl sm:text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                  {dimHasInstalls ? formatNumber(overview.totals.device_installs) : 'N/A'}
                </div>
                {!dimHasInstalls && (
                  <span className="rounded-full bg-[#8d6b32]/15 px-2 py-0.5 text-[10px] font-medium text-[#725524]">
                    Funnel only
                  </span>
                )}
              </div>
              <div className="mt-2 text-[11px] sm:text-xs text-[#4a4338] tabular-nums space-y-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dimHasInstalls) handleMetricMode(metricMode === 'active' ? 'installs' : 'active');
                  }}
                  className={`w-full flex justify-between gap-1 rounded px-1 -mx-1 transition-colors ${
                    dimHasInstalls ? 'cursor-pointer hover:bg-[#1e4636]/10' : ''
                  } ${metricMode === 'active' ? 'bg-[#1e4636]/12 font-semibold' : ''}`}
                >
                  <span className="text-[#6e6558]">Active</span>
                  <strong className="text-[#1e4636]">
                    {dimHasInstalls ? formatNumber(overview.totals.active_devices) : '—'}
                  </strong>
                </button>
                <div className="flex justify-between gap-1">
                  <span className="text-[#6e6558]">Window +/-</span>
                  <span>
                    {dimHasInstalls
                      ? `+${formatNumber(overview.window.device_installs)} / -${formatNumber(overview.window.user_uninstalls)}`
                      : '—'}
                  </span>
                </div>
                <div className="hidden sm:flex justify-between gap-1">
                  <span className="text-[#6e6558]">User installs / uninst.</span>
                  <span>
                    {dimHasInstalls
                      ? `${formatNumber(overview.totals.user_installs)} / ${formatNumber(overview.totals.user_uninstalls)}`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div
              onClick={() => dimHasStorePerf && handleMetricMode('funnel')}
              className={`rounded-2xl border bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs transition-all ${
                dimHasStorePerf ? 'cursor-pointer hover:border-[#8d6b32]/65' : ''
              } ${
                metricMode === 'funnel'
                  ? 'border-[#8d6b32] ring-1 ring-[#8d6b32]/30'
                  : 'border-[#d5cdb8]'
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <span>Store Funnel</span>
                {dimHasStorePerf ? (
                  <span className="rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[10px] sm:text-[11px] text-[#1e4636] font-medium tabular-nums normal-case">
                    {overview.totals.conversion_rate.toFixed(1)}%
                  </span>
                ) : (
                  <span className="rounded-full bg-[#e7e0d2] px-2 py-0.5 text-[10px] text-[#6e6558] normal-case">
                    Country/Traffic only
                  </span>
                )}
              </div>
              <div className="mt-1.5 sm:mt-2 text-2xl sm:text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                {dimHasStorePerf ? (
                  <>
                    {formatNumber(overview.totals.store_acquisitions)}
                    <span className="text-xs sm:text-sm font-sans font-normal text-[#6e6558] ml-1">acq</span>
                  </>
                ) : (
                  <span className="text-xl text-[#8d8475]">N/A</span>
                )}
              </div>
              <div className="mt-2 text-[11px] sm:text-xs text-[#4a4338] tabular-nums space-y-1">
                <div className="flex justify-between gap-1">
                  <span className="text-[#6e6558]">Visitors</span>
                  <strong>{dimHasStorePerf ? formatNumber(overview.totals.store_visitors) : '—'}</strong>
                </div>
                <div className="flex justify-between gap-1">
                  <span className="text-[#6e6558]">Win acq/vis</span>
                  <span>
                    {dimHasStorePerf
                      ? `${formatNumber(overview.window.store_acquisitions)} / ${formatNumber(overview.window.store_visitors)}`
                      : '—'}
                  </span>
                </div>
                <div className="hidden sm:flex justify-between gap-1">
                  <span className="text-[#6e6558]">Window conversion</span>
                  <span>{dimHasStorePerf ? `${overview.window.conversion_rate.toFixed(1)}%` : '—'}</span>
                </div>
              </div>
            </div>

            <div
              onClick={() => dimHasInstalls && handleMetricMode('ratings')}
              className={`rounded-2xl border bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs transition-all ${
                dimHasInstalls ? 'cursor-pointer hover:border-[#8d6b32]/65' : ''
              } ${
                metricMode === 'ratings'
                  ? 'border-[#8d6b32] ring-1 ring-[#8d6b32]/30'
                  : 'border-[#d5cdb8]'
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <span>Rating</span>
                {prodTrack && (() => {
                  const prodCode = prodTrack.version_codes.split(',')[0]?.trim() || '';
                  const isProdActive = Boolean(
                    prodCode && filters.dimType === 'app_version' && filters.dimValue === prodCode,
                  );
                  return (
                    <button
                      type="button"
                      disabled={!prodCode}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (prodCode) togglePlayDim('app_version', prodCode);
                      }}
                      title={prodCode ? `Filter by production vCode ${prodCode}` : undefined}
                      className={`rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] font-medium normal-case truncate max-w-[85px] sm:max-w-none transition-colors ${
                        prodCode ? 'cursor-pointer' : ''
                      } ${
                        isProdActive
                          ? 'bg-[#1e4636] text-[#faf7f1]'
                          : 'bg-[#1e4636]/12 text-[#1e4636] hover:bg-[#1e4636]/22'
                      }`}
                    >
                      v{prodTrack.release_name}
                    </button>
                  );
                })()}
              </div>
              <div className="mt-1.5 sm:mt-2 text-2xl sm:text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                {dimHasInstalls && overview.totals.total_avg_rating !== null
                  ? `${overview.totals.total_avg_rating.toFixed(2)} ★`
                  : '—'}
              </div>
              <div className="mt-2 text-[11px] sm:text-xs text-[#4a4338] tabular-nums space-y-1">
                <div className="flex justify-between gap-1">
                  <span className="text-[#6e6558]">Reviews</span>
                  <strong>
                    {chartTime || starFilter !== null
                      ? `${filteredReviews.length} / ${overview.totals.reviews_count}`
                      : formatNumber(overview.totals.reviews_count)}
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dimHasCrashes) handleMetricMode('vitals');
                  }}
                  className={`w-full flex justify-between gap-1 rounded px-1 -mx-1 transition-colors ${
                    dimHasCrashes ? 'cursor-pointer hover:bg-[#a4513a]/10' : ''
                  } ${metricMode === 'vitals' ? 'bg-[#a4513a]/12 font-semibold' : ''}`}
                >
                  <span className="text-[#6e6558]">Crash / ANR</span>
                  <span>
                    {dimHasCrashes
                      ? `${formatNumber(overview.totals.total_crashes)} / ${formatNumber(overview.totals.total_anrs)}`
                      : 'N/A'}
                  </span>
                </button>
                <div className="hidden sm:flex justify-between gap-1">
                  <span className="text-[#6e6558]">Update events</span>
                  <span>{dimHasInstalls ? formatNumber(overview.totals.update_events) : '—'}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <button
                  type="button"
                  onClick={() => onOpenPolls?.()}
                  className={`hover:text-[#1e4636] transition-colors ${onOpenPolls ? 'cursor-pointer' : ''}`}
                >
                  Play Sync
                </button>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] font-medium normal-case ${
                    overview.sync.status === 'ok'
                      ? 'bg-[#1e4636]/12 text-[#1e4636]'
                      : 'bg-[#8d6b32]/15 text-[#725524]'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1e4636]" />
                  {overview.sync.status}
                </span>
              </div>
              <div className="mt-1.5 sm:mt-2 flex items-baseline justify-between gap-1">
                <span className="text-xl sm:text-2xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                  {formatCountdown(overview.sync.next_scheduled_at, nowMs)}
                </span>
                <span className="text-[11px] sm:text-xs text-[#6e6558] hidden sm:inline">next sync</span>
              </div>
              <div className="mt-2 text-[11px] sm:text-xs text-[#4a4338] tabular-nums space-y-1">
                <div className="flex justify-between gap-1">
                  <span className="text-[#6e6558]">Last</span>
                  <span className="truncate">
                    {formatRelativeTime(overview.sync.last_polled_at, nowMs)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (dimHasHourlyVitals) handleGranularity('hour');
                  }}
                  className={`w-full flex justify-between gap-1 rounded px-1 -mx-1 transition-colors ${
                    dimHasHourlyVitals ? 'cursor-pointer hover:bg-[#1e4636]/10' : ''
                  }`}
                >
                  <span className="text-[#6e6558]">Hourly errors</span>
                  <strong className="text-[#a4513a]">
                    {dimHasHourlyVitals ? formatNumber(overview.totals.hourly_errors_total) : 'N/A'}
                  </strong>
                </button>
                <div className="hidden sm:flex justify-between gap-1">
                  <span className="text-[#6e6558]">Report range</span>
                  <span>
                    {overview.sync.first_report_date ?? '—'} → {overview.sync.latest_report_date ?? '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Play Chart */}
          {ts && (
            <PlayChart
              data={ts}
              mode={metricMode}
              onChangeMode={handleMetricMode}
              tz={filters.tz}
              selectedRange={chartTime}
              onSelectRange={setChartTime}
              activeDimType={filters.dimType}
              activeDimValue={filters.dimValue}
              onClearDim={() => setFilters((p) => ({ ...p, dimType: '', dimValue: '' }))}
            />
          )}

          {/* Dimension Explorer (Country, Device, App Version, OS, Language, Carrier, Traffic Source) */}
          <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 shadow-xs overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#e7e0d2]">
              <div>
                <h2 className="text-base sm:text-lg font-medium text-[#1c1914]">
                  Play Console Breakdowns ({overview.window.from} → {overview.window.to})
                </h2>
                <p className="text-xs text-[#6e6558]">
                  Tap any bar or dimension row to cross-filter KPIs, charts, reviews, and vitals.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <input
                  type="search"
                  value={dimSearch}
                  onChange={(e) => setDimSearch(e.target.value)}
                  placeholder="Filter dimension..."
                  className="flex-1 min-w-[140px] sm:w-44 rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 text-sm sm:text-xs text-[#1c1914]"
                />
                <a
                  href={playCsvExportURL('countries', effectiveFilters)}
                  className="rounded-full border border-[#d5cdb8] bg-[#f3eee4] px-3 py-1.5 text-xs font-medium text-[#1c1914] hover:border-[#8d6b32] whitespace-nowrap"
                >
                  Countries CSV
                </a>
              </div>
            </div>

            <div className="px-4 sm:px-5 pt-3 flex overflow-x-auto no-scrollbar sm:flex-wrap gap-1.5 border-b border-[#ece5d7] pb-3">
              {(
                [
                  ['country', `Countries (${overview.by_country.length})`],
                  ['device', `Devices (${overview.by_device.length})`],
                  ['app_version', `App Versions (${overview.by_app_version.length})`],
                  ['os_version', `Android OS (${overview.by_os_version.length})`],
                  ['language', `Languages (${overview.by_language.length})`],
                  ['carrier', `Carriers (${overview.by_carrier.length})`],
                  ['traffic_source', `Traffic (${overview.by_traffic_source.length})`],
                ] as [PlayDimTab, string][]
              ).map(([id, label]) => {
                const isActiveTab = dimTab === id;
                const ownsSelection = filters.dimType === id && Boolean(filters.dimValue);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setDimTab(id);
                      if (id !== 'country' && barMetric === 'store_visitors') {
                        setBarMetric('device_installs');
                      }
                    }}
                    className={`whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 sm:py-1 text-xs cursor-pointer transition-colors ${
                      isActiveTab
                        ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                        : ownsSelection
                          ? 'bg-[#1e4636]/15 text-[#1e4636] font-medium ring-1 ring-[#1e4636]/40'
                          : 'bg-[#f3eee4] text-[#4a4338] hover:text-[#1c1914]'
                    }`}
                  >
                    {ownsSelection && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isActiveTab ? 'bg-[#faf7f1]' : 'bg-[#1e4636]'
                        }`}
                      />
                    )}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {dimTab === 'traffic_source' && topTrafficBars.length > 0 && (() => {
              const maxTrafficVal = Math.max(1, ...topTrafficBars.map((r) => r[trafficBarMetric]));
              const hasActiveTraffic = filters.dimType === 'traffic_source' && filters.dimValue !== '';
              return (
                <div className="px-4 sm:px-5 py-3.5 border-b border-[#ece5d7] bg-[#f7f3ea]/60">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div className="text-xs font-medium text-[#1c1914]">
                      Top {topTrafficBars.length} Traffic Sources
                      <span className="ml-1.5 font-normal text-[#6e6558]">
                        · Click a bar to filter Store Funnel
                      </span>
                    </div>
                    <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#fffcf6] p-0.5 text-[11px]">
                      {(
                        [
                          ['acquisitions', 'Acquisitions'],
                          ['visitors', 'Visitors'],
                        ] as const
                      ).map(([m, lbl]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTrafficBarMetric(m)}
                          className={`rounded-full px-2.5 py-0.5 cursor-pointer transition-colors ${
                            trafficBarMetric === m
                              ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                              : 'text-[#4a4338] hover:text-[#1c1914]'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
                    {topTrafficBars.map((row) => {
                      const val = row[trafficBarMetric];
                      const pct = Math.max(val > 0 ? 2 : 0, (val / maxTrafficVal) * 100);
                      const clickable = Boolean(row.traffic_source);
                      const isSelected =
                        clickable &&
                        filters.dimType === 'traffic_source' &&
                        filters.dimValue === row.traffic_source;
                      return (
                        <button
                          key={row.traffic_source || '_unknown'}
                          type="button"
                          disabled={!clickable}
                          onClick={() => {
                            if (clickable) togglePlayDim('traffic_source', row.traffic_source);
                          }}
                          className={`w-full text-left rounded-lg px-2 py-1 transition-all ${
                            clickable ? 'cursor-pointer' : 'cursor-default opacity-70'
                          } ${
                            isSelected
                              ? 'bg-[#1e4636]/12 ring-1 ring-[#1e4636]/40'
                              : hasActiveTraffic
                                ? 'opacity-45 hover:opacity-85 hover:bg-[#efe9dc]/70'
                                : 'hover:bg-[#efe9dc]/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs mb-1">
                            <span
                              className={`truncate ${
                                isSelected ? 'font-semibold text-[#1e4636]' : 'font-medium text-[#1c1914]'
                              }`}
                            >
                              {row.traffic_source || '(Not specified)'}
                            </span>
                            <span className="tabular-nums text-[#4a4338] shrink-0">
                              {formatNumber(val)}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-[#e3dccb] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: isSelected
                                  ? '#1e4636'
                                  : hasActiveTraffic
                                    ? '#bfb7a5'
                                    : '#8d6b32',
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {dimTab !== 'traffic_source' && topChartRows.length > 0 && (() => {
              const activeMetric: PlayBarMetric =
                dimTab !== 'country' && barMetric === 'store_visitors'
                  ? 'device_installs'
                  : barMetric;
              const maxBarVal = Math.max(1, ...topChartRows.map((r) => r[activeMetric]));
              const hasActiveTabSelection =
                canClickActiveDimTab &&
                filters.dimType === dimTab &&
                filters.dimValue !== '';
              const barColor =
                activeMetric === 'crashes'
                  ? '#a4513a'
                  : activeMetric === 'store_visitors'
                    ? '#8d6b32'
                    : activeMetric === 'active_devices'
                      ? '#2b6b74'
                      : '#1e4636';
              const metricButtons: [PlayBarMetric, string][] =
                dimTab === 'country'
                  ? [
                      ['device_installs', 'Installs'],
                      ['active_devices', 'Active'],
                      ['store_visitors', 'Visitors'],
                      ['crashes', 'Crashes'],
                    ]
                  : [
                      ['device_installs', 'Installs'],
                      ['active_devices', 'Active'],
                      ['crashes', 'Crashes'],
                    ];

              return (
                <div className="px-4 sm:px-5 py-3.5 border-b border-[#ece5d7] bg-[#f7f3ea]/60">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div className="text-xs font-medium text-[#1c1914]">
                      Top {topChartRows.length}{' '}
                      {PLAY_DIM_LABELS[dimTab as Exclude<PlayDimFilterType, ''>]}
                      <span className="ml-1.5 font-normal text-[#6e6558]">
                        · Click a bar to filter
                      </span>
                    </div>
                    <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#fffcf6] p-0.5 text-[11px]">
                      {metricButtons.map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setBarMetric(m)}
                          className={`rounded-full px-2.5 py-0.5 cursor-pointer transition-colors ${
                            activeMetric === m
                              ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                              : 'text-[#4a4338] hover:text-[#1c1914]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
                    {topChartRows.map((row) => {
                      const val = row[activeMetric];
                      const pct = Math.max(val > 0 ? 2 : 0, (val / maxBarVal) * 100);
                      const clickable = Boolean(row.dimension_value);
                      const isSelected =
                        clickable &&
                        filters.dimType === dimTab &&
                        filters.dimValue === row.dimension_value;
                      const label = formatPlayDimValue(
                        dimTab as Exclude<PlayDimFilterType, ''>,
                        row.dimension_value,
                      );

                      return (
                        <button
                          key={row.dimension_value || '_unknown'}
                          type="button"
                          disabled={!clickable}
                          onClick={() => {
                            if (clickable) {
                              togglePlayDim(
                                dimTab as Exclude<PlayDimFilterType, ''>,
                                row.dimension_value,
                              );
                            }
                          }}
                          className={`w-full text-left rounded-lg px-2 py-1 transition-all ${
                            clickable ? 'cursor-pointer' : 'cursor-default opacity-70'
                          } ${
                            isSelected
                              ? 'bg-[#1e4636]/12 ring-1 ring-[#1e4636]/40'
                              : hasActiveTabSelection
                                ? 'opacity-45 hover:opacity-85 hover:bg-[#efe9dc]/70'
                                : 'hover:bg-[#efe9dc]/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs mb-1">
                            <span
                              className={`truncate ${
                                isSelected
                                  ? 'font-semibold text-[#1e4636]'
                                  : 'font-medium text-[#1c1914]'
                              }`}
                            >
                              {label}
                            </span>
                            <span className="tabular-nums text-[#4a4338] shrink-0">
                              {formatNumber(val)}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-[#e3dccb] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: isSelected
                                  ? '#1e4636'
                                  : hasActiveTabSelection
                                    ? '#bfb7a5'
                                    : barColor,
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="max-h-[460px] overflow-y-auto overflow-x-auto">
              {dimTab === 'traffic_source' ? (
                <>
                  {/* Mobile cards for Traffic Sources */}
                  <div className="md:hidden divide-y divide-[#ece5d7]">
                    {filteredTrafficRows.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#6e6558]">
                        No traffic source data recorded in this window.
                      </div>
                    ) : (
                      filteredTrafficRows.map((row, idx) => {
                        const clickable = Boolean(row.traffic_source);
                        const isSelected =
                          clickable &&
                          filters.dimType === 'traffic_source' &&
                          filters.dimValue === row.traffic_source;
                        const hasDim = filters.dimType === 'traffic_source' && filters.dimValue !== '';
                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={!clickable}
                            onClick={() => {
                              if (clickable) togglePlayDim('traffic_source', row.traffic_source);
                            }}
                            className={`w-full text-left p-3.5 text-xs space-y-1.5 tabular-nums transition-colors ${
                              clickable ? 'cursor-pointer' : 'cursor-default opacity-70'
                            } ${
                              isSelected
                                ? 'bg-[#1e4636]/10 border-l-4 border-[#1e4636]'
                                : hasDim
                                  ? 'opacity-55 hover:opacity-95'
                                  : 'hover:bg-[#f3eee4]/60'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium text-[#1c1914] truncate">
                                  {row.traffic_source || '—'}
                                </div>
                                {(row.search_term || row.utm_source || row.utm_campaign) && (
                                  <div className="text-[11px] text-[#6e6558] truncate">
                                    {row.search_term ? `"${row.search_term}" · ` : ''}
                                    {row.utm_source} / {row.utm_campaign}
                                  </div>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-semibold text-[#1e4636]">{formatNumber(row.acquisitions)} acq</div>
                                <div className="text-[11px] text-[#6e6558]">
                                  {formatNumber(row.visitors)} vis · {row.conversion_rate.toFixed(1)}%
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Desktop table for Traffic Sources */}
                  <table className="hidden md:table w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-[#f7f3ea] border-b border-[#e7e0d2] text-[11px] uppercase tracking-wider text-[#6e6558]">
                      <tr>
                        <th className="py-2.5 pl-5 pr-3">Traffic Source</th>
                        <th className="py-2.5 px-3">Search Term</th>
                        <th className="py-2.5 px-3">UTM Source / Campaign</th>
                        <th className="py-2.5 px-3 text-right">Visitors</th>
                        <th className="py-2.5 px-3 text-right">Acquisitions</th>
                        <th className="py-2.5 pl-3 pr-5 text-right">Conversion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ece5d7] tabular-nums">
                      {filteredTrafficRows.map((row, idx) => {
                        const clickable = Boolean(row.traffic_source);
                        const isSelected =
                          clickable &&
                          filters.dimType === 'traffic_source' &&
                          filters.dimValue === row.traffic_source;
                        const hasDim = filters.dimType === 'traffic_source' && filters.dimValue !== '';
                        return (
                          <tr
                            key={idx}
                            onClick={() => {
                              if (clickable) togglePlayDim('traffic_source', row.traffic_source);
                            }}
                            className={`transition-colors ${
                              clickable ? 'cursor-pointer' : 'cursor-default opacity-75'
                            } ${
                              isSelected
                                ? 'bg-[#1e4636]/12 font-semibold'
                                : hasDim
                                  ? 'opacity-55 hover:opacity-95 hover:bg-[#f3eee4]/60'
                                  : 'hover:bg-[#f3eee4]/60'
                            }`}
                          >
                            <td className="py-2.5 pl-5 pr-3 font-medium text-[#1c1914]">{row.traffic_source || '—'}</td>
                            <td className="py-2.5 px-3 text-[#4a4338]">{row.search_term || '—'}</td>
                            <td className="py-2.5 px-3 text-[#6e6558]">
                              {row.utm_source} / {row.utm_campaign}
                            </td>
                            <td className="py-2.5 px-3 text-right text-[#4a4338]">{formatNumber(row.visitors)}</td>
                            <td className="py-2.5 px-3 text-right font-semibold text-[#1e4636]">
                              {formatNumber(row.acquisitions)}
                            </td>
                            <td className="py-2.5 pl-3 pr-5 text-right text-[#4a4338]">
                              {row.conversion_rate.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              ) : (
                <>
                  {/* Mobile cards for regular dimensions */}
                  <div className="md:hidden divide-y divide-[#ece5d7]">
                    {dimRows.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#6e6558]">
                        No rows recorded for this dimension in the selected window.
                      </div>
                    ) : (
                      dimRows.map((row) => {
                        const clickable = canClickActiveDimTab && Boolean(row.dimension_value);
                        const hasActiveTabSel =
                          canClickActiveDimTab &&
                          filters.dimType === dimTab &&
                          filters.dimValue !== '';
                        const isSelected =
                          clickable &&
                          filters.dimType === dimTab &&
                          filters.dimValue === row.dimension_value;
                        return (
                          <div
                            key={row.dimension_value || '_unknown'}
                            onClick={() => {
                              if (clickable) {
                                togglePlayDim(
                                  dimTab as Exclude<PlayDimFilterType, ''>,
                                  row.dimension_value,
                                );
                              }
                            }}
                            className={`p-3.5 text-xs space-y-2 tabular-nums transition-opacity ${
                              clickable ? 'cursor-pointer active:bg-[#f3eee4]' : ''
                            } ${
                              isSelected
                                ? 'bg-[#1e4636]/12 ring-1 ring-inset ring-[#1e4636]/30'
                                : hasActiveTabSel
                                  ? 'opacity-55'
                                  : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm text-[#1c1914] truncate">
                                {dimTab === 'country'
                                  ? countryName(row.dimension_value)
                                  : row.dimension_value || '(Not specified)'}
                              </span>
                              <div className="text-right shrink-0">
                                <span className="font-semibold text-[#1e4636]">
                                  +{formatNumber(row.device_installs)} inst
                                </span>
                                <span className="text-[#6e6558] ml-1.5">
                                  · {formatNumber(row.active_devices)} act
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5 text-[11px] text-[#4a4338]">
                              <div>
                                <span className="text-[#6e6558]">Uninst:</span>{' '}
                                <span className="text-[#a4513a]">{formatNumber(row.user_uninstalls)}</span>
                              </div>
                              <div>
                                {dimTab === 'country' ? (
                                  <>
                                    <span className="text-[#6e6558]">Acq/Vis:</span>{' '}
                                    {formatNumber(row.store_acquisitions)}/{formatNumber(row.store_visitors)}
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[#6e6558]">Usr:</span> {formatNumber(row.user_installs)}
                                  </>
                                )}
                              </div>
                              <div className="text-right">
                                {row.avg_rating !== null ? (
                                  <span className="text-[#8d6b32] font-medium">{row.avg_rating.toFixed(1)}★</span>
                                ) : (
                                  <span className="text-[#6e6558]">
                                    {formatNumber(row.crashes)}/{formatNumber(row.anrs)} err
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Desktop table */}
                  <table className="hidden md:table w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-[#f7f3ea] border-b border-[#e7e0d2] text-[11px] uppercase tracking-wider text-[#6e6558]">
                      <tr>
                        <th className="py-2.5 pl-5 pr-3">
                          {dimTab === 'country' ? 'Country' : dimTab.replace('_', ' ')}
                        </th>
                        <th className="py-2.5 px-3 text-right">Device Installs</th>
                        <th className="py-2.5 px-3 text-right">User Installs</th>
                        <th className="py-2.5 px-3 text-right">Uninstalls</th>
                        <th className="py-2.5 px-3 text-right">Active Devices</th>
                        <th className="py-2.5 px-3 text-right">Updates</th>
                        {dimTab === 'country' && (
                          <>
                            <th className="py-2.5 px-3 text-right">Store Visitors</th>
                            <th className="py-2.5 px-3 text-right">Acquisitions</th>
                          </>
                        )}
                        <th className="py-2.5 px-3 text-right">Rating</th>
                        <th className="py-2.5 pl-3 pr-5 text-right">Crashes / ANRs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ece5d7] tabular-nums">
                      {dimRows.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-[#6e6558]">
                            No rows recorded for this dimension in the selected window.
                          </td>
                        </tr>
                      ) : (
                        dimRows.map((row) => {
                          const clickable = canClickActiveDimTab && Boolean(row.dimension_value);
                          const hasActiveTabSel =
                            canClickActiveDimTab &&
                            filters.dimType === dimTab &&
                            filters.dimValue !== '';
                          const isSelected =
                            clickable &&
                            filters.dimType === dimTab &&
                            filters.dimValue === row.dimension_value;
                          return (
                            <tr
                              key={row.dimension_value || '_unknown'}
                              onClick={() => {
                                if (clickable) {
                                  togglePlayDim(
                                    dimTab as Exclude<PlayDimFilterType, ''>,
                                    row.dimension_value,
                                  );
                                }
                              }}
                              className={`transition-opacity ${
                                clickable ? 'cursor-pointer' : ''
                              } ${
                                isSelected
                                  ? 'bg-[#1e4636]/12 font-medium'
                                  : hasActiveTabSel
                                    ? 'opacity-55 hover:opacity-95 hover:bg-[#f3eee4]/60'
                                    : 'hover:bg-[#f3eee4]/60'
                              }`}
                            >
                              <td className="py-2.5 pl-5 pr-3 font-medium text-[#1c1914]">
                                {dimTab === 'country'
                                  ? countryName(row.dimension_value)
                                  : row.dimension_value || '(Not specified)'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold text-[#1e4636]">
                                {formatNumber(row.device_installs)}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#4a4338]">
                                {formatNumber(row.user_installs)}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#a4513a]">
                                {formatNumber(row.user_uninstalls)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-medium text-[#1c1914]">
                                {formatNumber(row.active_devices)}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#6e6558]">
                                {formatNumber(row.update_events)}
                              </td>
                              {dimTab === 'country' && (
                                <>
                                  <td className="py-2.5 px-3 text-right text-[#4a4338]">
                                    {formatNumber(row.store_visitors)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-[#1e4636]">
                                    {formatNumber(row.store_acquisitions)}
                                  </td>
                                </>
                              )}
                              <td className="py-2.5 px-3 text-right text-[#8d6b32]">
                                {row.avg_rating !== null ? `${row.avg_rating.toFixed(1)} ★` : '—'}
                              </td>
                              <td className="py-2.5 pl-3 pr-5 text-right text-[#6e6558]">
                                {formatNumber(row.crashes)} / {formatNumber(row.anrs)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>

          {/* Reviews, Tracks & Reporting API Vitals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
            {/* Reviews & Tracks */}
            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-4 sm:p-5 shadow-xs space-y-4">
              <div>
                <h3 className="text-base font-medium text-[#1c1914]">
                  Play Store Reviews &amp; Ratings ({filteredReviews.length}
                  {filteredReviews.length !== reviews.length ? ` / ${reviews.length}` : ''})
                </h3>
                <p className="text-xs text-[#6e6558]">
                  Tap stars, tracks, versions, devices, or languages to cross-filter
                  {filteredReviews.length !== reviews.length ? ' · Cross-filtered by selection' : ''}
                </p>
              </div>

              {overview.tracks.length > 0 && (
                <div className="space-y-2">
                  {overview.tracks.map((tr) => {
                    const codes = tr.version_codes
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const primaryCode = codes[0] ?? '';
                    const isTrackActive = Boolean(
                      filters.dimType === 'app_version' && codes.includes(filters.dimValue),
                    );
                    const hasAppVersionFilter = filters.dimType === 'app_version' && filters.dimValue !== '';
                    return (
                      <div
                        key={tr.track_name}
                        onClick={() => primaryCode && togglePlayDim('app_version', primaryCode)}
                        className={`rounded-xl border p-3 text-xs transition-all ${
                          primaryCode ? 'cursor-pointer' : ''
                        } ${
                          isTrackActive
                            ? 'border-[#1e4636] bg-[#1e4636]/12 ring-1 ring-[#1e4636]/30'
                            : hasAppVersionFilter
                              ? 'border-[#d5cdb8] bg-[#f7f3ea]/60 opacity-60 hover:opacity-95'
                              : 'border-[#d5cdb8] bg-[#f7f3ea] hover:border-[#1e4636]/55'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-[#1c1914] uppercase tracking-wider text-[11px]">
                            {tr.track_name} · {tr.release_name || 'unnamed'}
                          </span>
                          <div className="flex flex-wrap items-center gap-1">
                            {codes.length > 1 ? (
                              codes.map((code) => {
                                const codeActive =
                                  filters.dimType === 'app_version' && filters.dimValue === code;
                                return (
                                  <button
                                    key={code}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePlayDim('app_version', code);
                                    }}
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                                      codeActive
                                        ? 'bg-[#1e4636] text-[#faf7f1]'
                                        : 'bg-[#1e4636]/12 text-[#1e4636] hover:bg-[#1e4636]/20'
                                    }`}
                                  >
                                    code {code}
                                  </button>
                                );
                              })
                            ) : (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  isTrackActive
                                    ? 'bg-[#1e4636] text-[#faf7f1]'
                                    : 'bg-[#1e4636]/12 text-[#1e4636]'
                                }`}
                              >
                                {tr.status} · code {tr.version_codes}
                              </span>
                            )}
                          </div>
                        </div>
                        {tr.release_notes && (
                          <p className="mt-1.5 text-[#4a4338] line-clamp-2">{tr.release_notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Interactive Star Rating Distribution */}
              {reviewsBeforeStar.length > 0 && (() => {
                const maxStar = Math.max(1, ...[5, 4, 3, 2, 1].map((s) => starCounts[s] ?? 0));
                return (
                  <div className="rounded-xl border border-[#e7e0d2] bg-[#f7f3ea]/75 p-2.5 space-y-1">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const cnt = starCounts[star] ?? 0;
                      const pct = cnt > 0 ? Math.max(4, Math.round((cnt / maxStar) * 100)) : 0;
                      const isSelected = starFilter === star;
                      const isDimmed = starFilter !== null && !isSelected;
                      return (
                        <button
                          key={star}
                          type="button"
                          onClick={() => toggleStarFilter(star)}
                          className={`w-full flex items-center gap-2 rounded-md px-1.5 py-0.5 text-[11px] cursor-pointer transition-all tabular-nums ${
                            isSelected
                              ? 'bg-[#1e4636]/12 ring-1 ring-[#1e4636]/35 font-semibold text-[#1e4636]'
                              : isDimmed
                                ? 'opacity-45 hover:opacity-90'
                                : 'hover:bg-[#efe9dc]'
                          }`}
                        >
                          <span className="w-8 text-left text-[#8d6b32] shrink-0">{star} ★</span>
                          <span className="flex-1 h-1.5 rounded-full bg-[#e3dccb] overflow-hidden">
                            <span
                              className="block h-full rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: isSelected
                                  ? '#1e4636'
                                  : isDimmed
                                    ? '#bfb7a5'
                                    : '#8d6b32',
                              }}
                            />
                          </span>
                          <span className="w-7 text-right text-[#4a4338] shrink-0">{cnt}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {filteredReviews.length === 0 ? (
                  <div className="text-xs text-[#6e6558] py-6 text-center">
                    {reviews.length === 0
                      ? 'No reviews recorded yet.'
                      : 'No reviews match the active selection.'}
                  </div>
                ) : (
                  filteredReviews.map((rev) => {
                    const isStarActive = starFilter === rev.star_rating;
                    const isVerActive =
                      filters.dimType === 'app_version' && filters.dimValue === rev.app_version_code;
                    const isDeviceActive =
                      filters.dimType === 'device' && filters.dimValue === rev.device;
                    const langTarget = resolveReviewLangFilter(rev.reviewer_language);
                    const isLangActive =
                      filters.dimType === 'language' &&
                      filters.dimValue.toLowerCase().split(/[-_]/)[0] ===
                        rev.reviewer_language.toLowerCase().split(/[-_]/)[0];
                    return (
                      <div
                        key={rev.review_key}
                        className="rounded-xl border border-[#e7e0d2] bg-[#fffcf6] p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleStarFilter(rev.star_rating)}
                            title={`Filter ${rev.star_rating}-star reviews`}
                            className={`rounded px-1.5 py-0.5 font-semibold cursor-pointer transition-colors ${
                              isStarActive
                                ? 'bg-[#1e4636] text-[#faf7f1]'
                                : 'text-[#8d6b32] hover:bg-[#8d6b32]/12'
                            }`}
                          >
                            {'★'.repeat(Math.max(0, rev.star_rating))}
                            {'☆'.repeat(Math.max(0, 5 - rev.star_rating))}
                          </button>
                          <div className="flex flex-wrap items-center gap-1 text-[11px] sm:text-xs text-[#6e6558] tabular-nums">
                            <button
                              type="button"
                              onClick={() => toggleBucketTimestamp(rev.submitted_at)}
                              title="Filter dashboard to this review's date"
                              className="hover:text-[#1e4636] hover:underline cursor-pointer"
                            >
                              {formatTimestamp(rev.submitted_at, filters.tz)}
                            </button>
                            {rev.app_version_code && (
                              <button
                                type="button"
                                onClick={() => togglePlayDim('app_version', rev.app_version_code)}
                                title={`Filter Play dashboard to vCode ${rev.app_version_code}`}
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                                  isVerActive
                                    ? 'bg-[#1e4636] text-[#faf7f1]'
                                    : 'bg-[#f3eee4] text-[#4a4338] hover:bg-[#1e4636]/15 hover:text-[#1e4636]'
                                }`}
                              >
                                v{rev.app_version_name || rev.app_version_code}
                              </button>
                            )}
                            {rev.device && (
                              <button
                                type="button"
                                onClick={() => togglePlayDim('device', rev.device)}
                                title={`Filter Play dashboard to device ${rev.device}`}
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                                  isDeviceActive
                                    ? 'bg-[#1e4636] text-[#faf7f1]'
                                    : 'bg-[#f3eee4] text-[#4a4338] hover:bg-[#1e4636]/15 hover:text-[#1e4636]'
                                }`}
                              >
                                {rev.device}
                              </button>
                            )}
                            {rev.reviewer_language && (
                              <button
                                type="button"
                                onClick={() => togglePlayDim('language', langTarget)}
                                title={`Filter Play dashboard to language ${rev.reviewer_language}`}
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                                  isLangActive
                                    ? 'bg-[#1e4636] text-[#faf7f1]'
                                    : 'bg-[#f3eee4] text-[#4a4338] hover:bg-[#1e4636]/15 hover:text-[#1e4636]'
                                }`}
                              >
                                {rev.reviewer_language}
                              </button>
                            )}
                          </div>
                        </div>
                        {(rev.review_title || rev.review_text) ? (
                          <p className="mt-1.5 text-[#1c1914]">
                            {rev.review_title && <strong className="mr-1.5">{rev.review_title}</strong>}
                            {rev.review_text}
                          </p>
                        ) : (
                          <p className="mt-1 text-[#6e6558] italic">Star rating without written comment</p>
                        )}
                        {rev.reply_text && (
                          <p className="mt-1.5 pl-2.5 border-l-2 border-[#1e4636] text-[#4a4338]">
                            <strong>Developer reply:</strong> {rev.reply_text}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Reporting API Vitals */}
            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-4 sm:p-5 shadow-xs space-y-3">
              <div>
                <h3 className="text-base font-medium text-[#1c1914]">
                  Play Developer Reporting Vitals ({filteredVitals.length}
                  {filteredVitals.length !== vitals.length ? ` / ${vitals.length}` : ''})
                </h3>
                <p className="text-xs text-[#6e6558]">
                  Tap a version row to filter App Version, or tap a timestamp to slice by bucket
                  {filteredVitals.length !== vitals.length ? ' · Cross-filtered by selection' : ''}
                </p>
              </div>

              {/* Mobile Vitals Cards */}
              <div className="md:hidden divide-y divide-[#ece5d7] max-h-80 overflow-y-auto">
                {filteredVitals.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#6e6558]">
                    {vitals.length === 0
                      ? 'No Reporting API buckets stored yet.'
                      : 'No Reporting API buckets match the active selection.'}
                  </div>
                ) : (
                  filteredVitals.slice(0, 80).map((v, idx) => {
                    const vCode =
                      v.dimension_key === 'reportType,versionCode'
                        ? v.dimension_value.split(',')[1]?.trim() ?? ''
                        : '';
                    const isVerActive = Boolean(
                      vCode && filters.dimType === 'app_version' && filters.dimValue === vCode,
                    );
                    return (
                      <div
                        key={idx}
                        onClick={() =>
                          vCode
                            ? togglePlayDim('app_version', vCode)
                            : toggleBucketTimestamp(v.bucket_start, v.aggregation_period === 'HOURLY' ? 'hour' : 'day')
                        }
                        className={`py-2.5 px-2 -mx-2 rounded-lg text-xs space-y-1 tabular-nums cursor-pointer transition-colors ${
                          isVerActive ? 'bg-[#1e4636]/12' : 'hover:bg-[#f3eee4]/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#1c1914] font-medium">
                            {formatTimestamp(v.bucket_start, filters.tz)}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              isVerActive ? 'bg-[#1e4636] text-[#faf7f1]' : 'bg-[#e7e0d2] text-[#4a4338]'
                            }`}
                          >
                            {v.dimension_value || v.aggregation_period}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                          <span className="font-mono text-[#6e6558]">{v.metric_set}</span>
                          <span className="text-[#1c1914]">
                            {Object.entries(v.metrics || {})
                              .map(([k, val]) => `${k}: ${val}`)
                              .join(' · ')}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="hidden md:block overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#f7f3ea] border-b border-[#e7e0d2] text-[10px] uppercase tracking-wider text-[#6e6558]">
                    <tr>
                      <th className="py-2 pr-2">Bucket ({filters.tz})</th>
                      <th className="py-2 px-2">Metric Set</th>
                      <th className="py-2 px-2">Period</th>
                      <th className="py-2 px-2">Dim</th>
                      <th className="py-2 pl-2 text-right">Values</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ece5d7] tabular-nums">
                    {filteredVitals.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[#6e6558]">
                          {vitals.length === 0
                            ? 'No Reporting API buckets stored yet.'
                            : 'No Reporting API buckets match the active selection.'}
                        </td>
                      </tr>
                    ) : (
                      filteredVitals.slice(0, 80).map((v, idx) => {
                        const vCode =
                          v.dimension_key === 'reportType,versionCode'
                            ? v.dimension_value.split(',')[1]?.trim() ?? ''
                            : '';
                        const isVerActive = Boolean(
                          vCode && filters.dimType === 'app_version' && filters.dimValue === vCode,
                        );
                        return (
                          <tr
                            key={idx}
                            onClick={() =>
                              vCode
                                ? togglePlayDim('app_version', vCode)
                                : toggleBucketTimestamp(
                                    v.bucket_start,
                                    v.aggregation_period === 'HOURLY' ? 'hour' : 'day',
                                  )
                            }
                            className={`cursor-pointer transition-colors ${
                              isVerActive ? 'bg-[#1e4636]/12 font-medium' : 'hover:bg-[#f3eee4]/60'
                            }`}
                          >
                            <td className="py-2 pr-2 text-[#1c1914] whitespace-nowrap">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleBucketTimestamp(
                                    v.bucket_start,
                                    v.aggregation_period === 'HOURLY' ? 'hour' : 'day',
                                  );
                                }}
                                className="hover:text-[#1e4636] hover:underline cursor-pointer"
                              >
                                {formatTimestamp(v.bucket_start, filters.tz)}
                              </button>
                            </td>
                            <td className="py-2 px-2 font-mono text-[11px] text-[#4a4338]">{v.metric_set}</td>
                            <td className="py-2 px-2">
                              <span className="rounded bg-[#e7e0d2] px-1.5 py-0.5 text-[10px]">
                                {v.aggregation_period}
                              </span>
                            </td>
                            <td className="py-2 px-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[11px] ${
                                  isVerActive
                                    ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                                    : 'text-[#6e6558]'
                                }`}
                              >
                                {v.dimension_value || '—'}
                              </span>
                            </td>
                            <td className="py-2 pl-2 text-right text-[#1c1914]">
                              {Object.entries(v.metrics || {})
                                .map(([k, val]) => `${k}: ${val}`)
                                .join(' · ')}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

interface PlayChartProps {
  data: PlayTimeSeriesResponse;
  mode: PlayMetricMode;
  onChangeMode: (m: PlayMetricMode) => void;
  tz: string;
  selectedRange?: TimeRangeSelection | null;
  onSelectRange?: (sel: TimeRangeSelection | null) => void;
  activeDimType?: PlayDimFilterType;
  activeDimValue?: string;
  onClearDim?: () => void;
}

function PlayChart({
  data,
  mode,
  onChangeMode,
  tz,
  selectedRange = null,
  onSelectRange,
  activeDimType = '',
  activeDimValue = '',
  onClearDim,
}: PlayChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(860);
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  const toggleSeries = (key: string) =>
    setHiddenSeries((prev) => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 100) setWidth(Math.floor(entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = data.points;
  const isNarrow = width < 520;
  const height = isNarrow ? 225 : 290;
  const margin = { top: 16, right: isNarrow ? 10 : 20, bottom: 32, left: isNarrow ? 34 : 48 };
  const plotW = Math.max(200, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;

  const maxVal = useMemo(() => {
    if (mode === 'ratings') return 5;
    let m = 0;
    for (const p of pts) {
      if (mode === 'installs') {
        if (!hiddenSeries.inst) m = Math.max(m, p.device_installs);
        if (!hiddenSeries.uninst) m = Math.max(m, p.user_uninstalls);
      } else if (mode === 'funnel') {
        if (!hiddenSeries.vis) m = Math.max(m, p.store_visitors);
        if (!hiddenSeries.acq) m = Math.max(m, p.store_acquisitions);
      } else if (mode === 'vitals') {
        if (!hiddenSeries.crash) m = Math.max(m, p.crashes);
        if (!hiddenSeries.users) m = Math.max(m, p.distinct_users);
      } else {
        m = Math.max(m, p.active_devices);
      }
    }
    return m <= 5 ? 5 : Math.ceil(m * 1.15);
  }, [pts, mode, hiddenSeries]);

  const yTicks = useMemo(() => {
    const steps = mode === 'ratings' ? 5 : 4;
    const arr: number[] = [];
    for (let i = 0; i <= steps; i++) arr.push(Math.round((maxVal * i) / steps));
    return arr;
  }, [maxVal, mode]);

  const step = pts.length > 0 ? plotW / pts.length : plotW;
  const barW = Math.max(2, Math.min(26, step * 0.65));
  const xCenter = (i: number) => margin.left + (i + 0.5) * step;
  const yScale = (v: number) => plotH - (v / maxVal) * plotH;
  const xLabelEvery = pts.length <= 10 ? 1 : Math.ceil(pts.length / Math.max(3, Math.floor(plotW / 86)));

  const linePoints = useMemo(() => {
    if (mode !== 'active' && mode !== 'ratings') return [];
    return pts
      .map((p, idx) => ({
        idx,
        val: mode === 'active' ? p.active_devices : p.total_avg_rating,
      }))
      .filter(
        (x) => x.val !== null && x.val !== undefined && (mode === 'active' || (x.val ?? 0) > 0),
      )
      .map((x) => ({ idx: x.idx, val: x.val as number }));
  }, [pts, mode]);

  const linePath = useMemo(() => {
    if (linePoints.length === 0) return '';
    return linePoints
      .map(
        (pt, i) =>
          `${i === 0 ? 'M' : 'L'} ${xCenter(pt.idx).toFixed(1)} ${(margin.top + yScale(pt.val)).toFixed(1)}`,
      )
      .join(' ');
  }, [linePoints, step, maxVal]);

  const { hoverIdx, setHoverIdx, dragBand, isDragging, svgHandlers } = useBucketBrush({
    count: pts.length,
    marginLeft: margin.left,
    plotW,
    onSelectRange: onSelectRange
      ? (loIdx, hiIdx) => {
          const sel = buildBucketSelection(
            pts,
            loIdx,
            hiIdx,
            data.granularity,
            tz,
            data.granularity !== 'hour',
          );
          if (!sel) return;
          if (selectedRange && selectedRange.from === sel.from && selectedRange.to === sel.to) {
            onSelectRange(null);
          } else {
            onSelectRange(sel);
          }
        }
      : undefined,
  });

  const hovered = hoverIdx !== null && pts[hoverIdx] ? pts[hoverIdx] : null;
  const isAnyHighlighted = Boolean(dragBand || selectedRange);
  const isIdxSelected = (idx: number): boolean => {
    if (dragBand) return idx >= dragBand.loIdx && idx <= dragBand.hiIdx;
    if (!selectedRange || !pts[idx]) return false;
    return isBucketInSelection(pts[idx].timestamp, selectedRange, tz);
  };

  const legendItems: { key: string; label: string; color: string; toggleable: boolean }[] =
    mode === 'installs'
      ? [
          { key: 'inst', label: 'Device Installs', color: '#1e4636', toggleable: true },
          { key: 'uninst', label: 'Uninstalls', color: '#a4513a', toggleable: true },
        ]
      : mode === 'funnel'
        ? [
            { key: 'vis', label: 'Store Visitors', color: '#8d6b32', toggleable: true },
            { key: 'acq', label: 'Acquisitions', color: '#1e4636', toggleable: true },
          ]
        : mode === 'vitals'
          ? [
              { key: 'crash', label: 'Crashes', color: '#a4513a', toggleable: true },
              { key: 'users', label: 'Distinct Users', color: '#2b6b74', toggleable: true },
            ]
          : mode === 'active'
            ? [{ key: 'active', label: 'Active Devices', color: '#1e4636', toggleable: false }]
            : [{ key: 'ratings', label: 'Avg Star Rating', color: '#8d6b32', toggleable: false }];

  return (
    <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 mb-2.5 sm:mb-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-medium text-[#1c1914]">
            {mode === 'installs' && 'Device Installs & Uninstalls'}
            {mode === 'active' && 'Active Device Installs'}
            {mode === 'funnel' && 'Store Visitors & Acquisitions'}
            {mode === 'ratings' && 'Average Star Rating & Crashes'}
            {mode === 'vitals' && 'Play Reporting Vitals'}
          </h2>
          <p className="text-[11px] sm:text-xs text-[#6e6558]">
            {pts.length} buckets · {data.granularity} · {data.timezone}
            {onSelectRange
              ? isNarrow
                ? ' · Tap bucket to filter'
                : ' · Click or drag across chart to filter'
              : ''}
          </p>
        </div>

        <div className="inline-flex overflow-x-auto no-scrollbar max-w-full rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
          {(
            [
              ['installs', 'Installs'],
              ['active', 'Active'],
              ['funnel', 'Funnel'],
              ['ratings', 'Rating'],
              ['vitals', 'Vitals'],
            ] as [PlayMetricMode, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeMode(id)}
              className={`whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 sm:py-1 cursor-pointer transition-colors ${
                mode === id
                  ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                  : 'text-[#4a4338] hover:text-[#1c1914]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive legend */}
      {(() => {
        let notice: string | null = null;
        if (activeDimType && activeDimValue) {
          if (activeDimType === 'traffic_source' && mode !== 'funnel') {
            notice = 'Google Play only exports Store Funnel metrics for Traffic Sources.';
          } else if (
            mode === 'funnel' &&
            activeDimType !== 'country' &&
            activeDimType !== 'traffic_source'
          ) {
            notice = `Google Play does not export Store Visitors/Acquisitions per ${PLAY_DIM_LABELS[activeDimType]}.`;
          } else if (mode === 'vitals' && data.granularity === 'hour' && activeDimType !== 'app_version') {
            notice = `Hourly Reporting Vitals support All or App Version (not ${PLAY_DIM_LABELS[activeDimType]}).`;
          } else if (
            mode === 'vitals' &&
            data.granularity !== 'hour' &&
            activeDimType !== 'app_version' &&
            activeDimType !== 'device' &&
            activeDimType !== 'os_version'
          ) {
            notice = `Daily crashes support All, App Version, Device, or Android OS (not ${PLAY_DIM_LABELS[activeDimType]}).`;
          }
        }
        return (
          <>
            {notice && (
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#8d6b32]/35 bg-[#8d6b32]/10 px-3 py-2 text-xs text-[#4a4338]">
                <span>{notice}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {activeDimType === 'traffic_source' && (
                    <button
                      type="button"
                      onClick={() => onChangeMode('funnel')}
                      className="rounded-full bg-[#1e4636] px-2.5 py-0.5 text-[11px] font-medium text-[#faf7f1] cursor-pointer hover:bg-[#143028]"
                    >
                      Show Funnel
                    </button>
                  )}
                  {onClearDim && (
                    <button
                      type="button"
                      onClick={onClearDim}
                      className="rounded-full border border-[#8d6b32]/40 bg-[#fffcf6] px-2.5 py-0.5 text-[11px] font-medium text-[#1c1914] cursor-pointer hover:border-[#1e4636]"
                    >
                      Clear {activeDimType ? PLAY_DIM_LABELS[activeDimType] : 'filter'}
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
          {legendItems.map((item) => {
            const hidden = item.toggleable && Boolean(hiddenSeries[item.key]);
            if (!item.toggleable) {
              return (
                <span
                  key={item.key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#e3dccb] bg-[#f7f3ea] px-2.5 py-0.5 text-[11px] text-[#4a4338]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </span>
              );
            }
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleSeries(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] cursor-pointer transition-colors ${
                  hidden
                    ? 'border-[#e3dccb] bg-[#f7f3ea]/60 text-[#9c9282] line-through'
                    : 'border-[#d5cdb8] bg-[#f7f3ea] text-[#1c1914] hover:border-[#8d6b32]'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.color, opacity: hidden ? 0.35 : 1 }}
                />
                {item.label}
              </button>
            );
          })}
        </div>
        {selectedRange && onSelectRange && (
          <button
            type="button"
            onClick={() => onSelectRange(null)}
            className="text-[11px] font-medium text-[#1e4636] hover:underline cursor-pointer"
          >
            Clear slice ({selectedRange.label})
          </button>
        )}
      </div>
          </>
        );
      })()}

      {/* Narrow-screen inline inspection bar (prevents floating tooltip overflow) */}
      {isNarrow && hovered && (
        <div className="mb-2 rounded-xl border border-[#d5cdb8] bg-[#f7f3ea] px-3 py-2 text-xs tabular-nums">
          <div className="flex items-center justify-between gap-2 font-semibold text-[#1c1914]">
            <span>{data.granularity === 'hour' ? formatTimestamp(hovered.timestamp, tz) : hovered.label}</span>
            <button
              type="button"
              onClick={() => setHoverIdx(null)}
              className="text-[11px] font-normal text-[#6e6558] px-1"
            >
              Clear
            </button>
          </div>
          {data.granularity === 'hour' ? (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#4a4338]">
              <span>
                Crash: <strong className="text-[#a4513a]">{formatNumber(hovered.crashes)}</strong>
              </span>
              <span>ANR: {formatNumber(hovered.anrs)}</span>
              <span>Users: {formatNumber(hovered.distinct_users)}</span>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#4a4338]">
              <span>
                Inst: <strong className="text-[#1e4636]">{formatNumber(hovered.device_installs)}</strong>
              </span>
              <span>Uninst: {formatNumber(hovered.user_uninstalls)}</span>
              <span>Act: {formatNumber(hovered.active_devices)}</span>
              <span>
                Funnel: {formatNumber(hovered.store_acquisitions)}/{formatNumber(hovered.store_visitors)}
              </span>
            </div>
          )}
        </div>
      )}

      <div ref={containerRef} className="relative w-full select-none">
        <svg
          width={width}
          height={height}
          className={`overflow-visible block touch-pan-y ${
            onSelectRange ? (isDragging ? 'cursor-grabbing' : 'cursor-crosshair') : ''
          }`}
          {...svgHandlers}
        >
          {yTicks.map((tick) => {
            const y = margin.top + yScale(tick);
            return (
              <g key={tick}>
                <line
                  x1={margin.left}
                  x2={margin.left + plotW}
                  y1={y}
                  y2={y}
                  stroke="#e3dccb"
                  strokeDasharray={tick === 0 ? undefined : '3 3'}
                />
                <text
                  x={margin.left - 6}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[#6e6558] text-[10px] sm:text-[11px] tabular-nums"
                >
                  {formatNumber(tick)}
                </text>
              </g>
            );
          })}

          {pts.map((_, idx) => {
            if (!isIdxSelected(idx)) return null;
            return (
              <g key={`sel-${idx}`}>
                <rect
                  x={margin.left + idx * step}
                  y={margin.top}
                  width={step}
                  height={plotH}
                  fill="#1e4636"
                  fillOpacity={0.14}
                />
                <rect
                  x={margin.left + idx * step}
                  y={margin.top}
                  width={step}
                  height={3}
                  fill="#1e4636"
                  rx={1}
                />
              </g>
            );
          })}

          {dragBand && (
            <rect
              x={margin.left + dragBand.loIdx * step}
              y={margin.top}
              width={(dragBand.hiIdx - dragBand.loIdx + 1) * step}
              height={plotH}
              fill="#1e4636"
              fillOpacity={0.08}
              stroke="#1e4636"
              strokeOpacity={0.55}
              strokeDasharray="4 3"
              rx={3}
            />
          )}

          {hoverIdx !== null && pts[hoverIdx] && (
            <rect
              x={margin.left + hoverIdx * step}
              y={margin.top}
              width={step}
              height={plotH}
              fill="#1e4636"
              fillOpacity={0.07}
              rx={3}
            />
          )}

          {(mode === 'installs' || mode === 'funnel' || mode === 'vitals') &&
            pts.map((p, idx) => {
              const cx = xCenter(idx);
              const selected = isIdxSelected(idx);
              const barOpacity = isAnyHighlighted && !selected ? 0.25 : 1;

              if (mode === 'installs') {
                const subW = Math.max(1.5, barW / 2);
                const h1 = (p.device_installs / maxVal) * plotH;
                const h2 = (p.user_uninstalls / maxVal) * plotH;
                return (
                  <g key={idx}>
                    {!hiddenSeries.inst && p.device_installs > 0 && (
                      <rect
                        x={cx - subW - 0.5}
                        y={margin.top + plotH - h1}
                        width={subW}
                        height={Math.max(1.5, h1)}
                        fill="#1e4636"
                        fillOpacity={barOpacity}
                        rx={1}
                      />
                    )}
                    {!hiddenSeries.uninst && p.user_uninstalls > 0 && (
                      <rect
                        x={cx + 0.5}
                        y={margin.top + plotH - h2}
                        width={subW}
                        height={Math.max(1.5, h2)}
                        fill="#a4513a"
                        fillOpacity={barOpacity}
                        rx={1}
                      />
                    )}
                  </g>
                );
              }
              if (mode === 'funnel') {
                const subW = Math.max(1.5, barW / 2);
                const h1 = (p.store_visitors / maxVal) * plotH;
                const h2 = (p.store_acquisitions / maxVal) * plotH;
                return (
                  <g key={idx}>
                    {!hiddenSeries.vis && p.store_visitors > 0 && (
                      <rect
                        x={cx - subW - 0.5}
                        y={margin.top + plotH - h1}
                        width={subW}
                        height={Math.max(1.5, h1)}
                        fill="#8d6b32"
                        fillOpacity={barOpacity}
                        rx={1}
                      />
                    )}
                    {!hiddenSeries.acq && p.store_acquisitions > 0 && (
                      <rect
                        x={cx + 0.5}
                        y={margin.top + plotH - h2}
                        width={subW}
                        height={Math.max(1.5, h2)}
                        fill="#1e4636"
                        fillOpacity={barOpacity}
                        rx={1}
                      />
                    )}
                  </g>
                );
              }
              const hCrash = (p.crashes / maxVal) * plotH;
              const hUsr = (p.distinct_users / maxVal) * plotH;
              return (
                <g key={idx}>
                  {!hiddenSeries.users && p.distinct_users > 0 && (
                    <rect
                      x={cx - barW / 2}
                      y={margin.top + plotH - hUsr}
                      width={barW}
                      height={Math.max(1.5, hUsr)}
                      fill="#2b6b74"
                      fillOpacity={selected ? 0.55 : isAnyHighlighted ? 0.12 : 0.35}
                      rx={1}
                    />
                  )}
                  {!hiddenSeries.crash && p.crashes > 0 && (
                    <rect
                      x={cx - barW / 2}
                      y={margin.top + plotH - hCrash}
                      width={barW}
                      height={Math.max(2, hCrash)}
                      fill="#a4513a"
                      fillOpacity={barOpacity}
                      rx={1}
                    />
                  )}
                </g>
              );
            })}

          {(mode === 'active' || mode === 'ratings') && linePath && (
            <>
              <path
                d={linePath}
                fill="none"
                stroke={mode === 'ratings' ? '#8d6b32' : '#1e4636'}
                strokeOpacity={isAnyHighlighted ? 0.45 : 1}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {linePoints.map((pt) => {
                const selected = isIdxSelected(pt.idx);
                const isHovered = hoverIdx === pt.idx;
                if (!selected && !isHovered && linePoints.length > 45) return null;
                return (
                  <circle
                    key={`pt-${pt.idx}`}
                    cx={xCenter(pt.idx)}
                    cy={margin.top + yScale(pt.val)}
                    r={selected || isHovered ? 4.5 : 2.5}
                    fill={
                      selected
                        ? '#1e4636'
                        : mode === 'ratings'
                          ? '#8d6b32'
                          : '#1e4636'
                    }
                    fillOpacity={isAnyHighlighted && !selected && !isHovered ? 0.25 : 1}
                    stroke="#fffcf6"
                    strokeWidth={selected || isHovered ? 1.5 : 0}
                  />
                );
              })}
            </>
          )}

          {pts.map((p, idx) => {
            if (idx % xLabelEvery !== 0 && idx !== pts.length - 1) return null;
            return (
              <text
                key={idx}
                x={xCenter(idx)}
                y={height - 10}
                textAnchor="middle"
                className="fill-[#6e6558] text-[10px] sm:text-[11px] tabular-nums"
              >
                {p.label}
              </text>
            );
          })}
        </svg>

        {!isNarrow && hovered && hoverIdx !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-52 rounded-xl border border-[#d5cdb8] bg-[#fffcf6]/95 p-3 shadow-md text-xs tabular-nums"
            style={{
              left:
                xCenter(hoverIdx) > width * 0.65
                  ? Math.max(8, xCenter(hoverIdx) - 220)
                  : Math.min(width - 220, xCenter(hoverIdx) + 12),
            }}
          >
            <div className="font-semibold text-[#1c1914] mb-1.5">
              {data.granularity === 'hour' ? formatTimestamp(hovered.timestamp, tz) : hovered.label}
            </div>
            {data.granularity === 'hour' ? (
              <div className="space-y-1 text-[#4a4338]">
                <div className="flex justify-between">
                  <span>Crashes:</span>
                  <strong className="text-[#a4513a]">{formatNumber(hovered.crashes)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>ANRs:</span>
                  <strong>{formatNumber(hovered.anrs)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Distinct Users:</span>
                  <strong>{formatNumber(hovered.distinct_users)}</strong>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-[#4a4338]">
                <div className="flex justify-between">
                  <span>Device / User installs:</span>
                  <strong className="text-[#1e4636]">
                    {formatNumber(hovered.device_installs)} / {formatNumber(hovered.user_installs)}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Uninstalls / Active:</span>
                  <span>
                    {formatNumber(hovered.user_uninstalls)} / {formatNumber(hovered.active_devices)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Store Visitors / Acq:</span>
                  <span>
                    {formatNumber(hovered.store_visitors)} / {formatNumber(hovered.store_acquisitions)} (
                    {hovered.conversion_rate.toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Rating / Crashes:</span>
                  <span>
                    {hovered.total_avg_rating ? `${hovered.total_avg_rating.toFixed(2)}★` : '—'} /{' '}
                    {formatNumber(hovered.crashes)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
