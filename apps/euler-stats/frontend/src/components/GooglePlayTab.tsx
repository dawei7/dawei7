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
  PlayOverviewResponse,
  PlayReviewView,
  PlayTimeSeriesPoint,
  PlayTimeSeriesResponse,
  PlayVitalsSummaryRow,
  RangePreset,
} from '../lib/types';
import {
  countryName,
  formatCountdown,
  formatNumber,
  formatRelativeTime,
  formatTimestamp,
} from '../lib/format';

type PlayMetricMode = 'installs' | 'active' | 'funnel' | 'ratings' | 'vitals';
type PlayDimTab =
  | 'country'
  | 'device'
  | 'app_version'
  | 'os_version'
  | 'language'
  | 'carrier'
  | 'traffic_source';

interface GooglePlayTabProps {
  defaultTz: string;
  tzOptions: string[];
  refreshTick: number;
}

export function GooglePlayTab({ defaultTz, tzOptions, refreshTick }: GooglePlayTabProps) {
  const [filters, setFilters] = useState<PlayFilterState>(() => ({
    granularity: 'day',
    range: '30d',
    from: '',
    to: '',
    tz: defaultTz,
    country: '',
  }));
  const [metricMode, setMetricMode] = useState<PlayMetricMode>('installs');
  const [dimTab, setDimTab] = useState<PlayDimTab>('country');
  const [dimSearch, setDimSearch] = useState('');

  const [overview, setOverview] = useState<PlayOverviewResponse | null>(null);
  const [ts, setTs] = useState<PlayTimeSeriesResponse | null>(null);
  const [reviews, setReviews] = useState<PlayReviewView[]>([]);
  const [vitals, setVitals] = useState<PlayVitalsSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      fetchPlayOverview(filters, ac.signal),
      fetchPlayTimeSeries(filters, ac.signal),
      fetchPlayReviews(200, ac.signal),
      fetchPlayVitals(150, ac.signal),
    ])
      .then(([ov, series, rev, vit]) => {
        setOverview(ov);
        setTs(series);
        setReviews(rev);
        setVitals(vit);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load Play Store stats');
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [filters, refreshTick]);

  const handleGranularity = (g: Granularity) => {
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
      setFilters((prev) => ({ ...prev, granularity: 'day' }));
    }
  };

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

  const prodTrack = overview?.tracks.find((t) => t.track_name === 'production');

  return (
    <div className="space-y-5">
      {/* Control Bar */}
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium mr-1">
              Granularity
            </span>
            <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
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
                  className={`rounded-full px-3 py-1 cursor-pointer transition-colors ${
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

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium mr-1">
              Window
            </span>
            <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
              {(['7d', '30d', '90d', 'all', 'custom'] as RangePreset[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setFilters((p) => ({ ...p, range: r }))}
                  className={`rounded-full px-2.5 py-1 cursor-pointer transition-colors ${
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

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={filters.country}
              onChange={(e) => setFilters((p) => ({ ...p, country: e.target.value }))}
              className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
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
              onChange={(e) => setFilters((p) => ({ ...p, tz: e.target.value }))}
              className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
            >
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>
                  TZ: {tz}
                </option>
              ))}
            </select>

            <a
              href={playCsvExportURL('timeseries', filters)}
              className="rounded-full border border-[#d5cdb8] bg-[#f3eee4] px-3 py-1.5 font-medium text-[#1c1914] hover:border-[#8d6b32] transition-colors"
            >
              Export Play CSV
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
                onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
                className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[#4a4338]">
              To:
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
                className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-xs"
              />
            </label>
          </div>
        )}

        <div className="text-[11px] text-[#6e6558] pt-1 border-t border-[#ece5d7]">
          <strong>Google Play Cadence:</strong> Installs, active devices, store performance, ratings, and country/device breakdowns are published by Google once per day (polled hourly via GCS object ETag checks with zero duplication). Crash/ANR &amp; active-user counts from Play Developer Reporting API also support <strong>hourly</strong> buckets.
        </div>
      </div>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs">
              <div className="flex items-center justify-between text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <span>Play Store Installs</span>
                <span className="rounded-full bg-[#e7e0d2] px-2 py-0.5 text-[11px] text-[#4a4338] normal-case">
                  {filters.country ? countryName(filters.country) : 'All Countries'}
                </span>
              </div>
              <div className="mt-2 text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                {formatNumber(overview.totals.device_installs)}
              </div>
              <div className="mt-2 text-xs text-[#4a4338] tabular-nums space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Active devices (latest)</span>
                  <strong className="text-[#1e4636]">{formatNumber(overview.totals.active_devices)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Window installs / uninstalls</span>
                  <span>
                    +{formatNumber(overview.window.device_installs)} / -{formatNumber(overview.window.user_uninstalls)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">User installs / uninstalls</span>
                  <span>
                    {formatNumber(overview.totals.user_installs)} / {formatNumber(overview.totals.user_uninstalls)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs">
              <div className="flex items-center justify-between text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <span>Store Listing Funnel</span>
                <span className="rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[11px] text-[#1e4636] font-medium tabular-nums normal-case">
                  {overview.totals.conversion_rate.toFixed(1)}% conv
                </span>
              </div>
              <div className="mt-2 text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                {formatNumber(overview.totals.store_acquisitions)}
                <span className="text-sm font-sans font-normal text-[#6e6558] ml-1.5">acq.</span>
              </div>
              <div className="mt-2 text-xs text-[#4a4338] tabular-nums space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">All-time store visitors</span>
                  <strong>{formatNumber(overview.totals.store_visitors)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Window acquisitions / visitors</span>
                  <span>
                    {formatNumber(overview.window.store_acquisitions)} / {formatNumber(overview.window.store_visitors)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Window conversion</span>
                  <span>{overview.window.conversion_rate.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs">
              <div className="flex items-center justify-between text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <span>Ratings &amp; Release</span>
                {prodTrack && (
                  <span className="rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[11px] text-[#1e4636] font-medium normal-case">
                    Prod {prodTrack.release_name}
                  </span>
                )}
              </div>
              <div className="mt-2 text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                {overview.totals.total_avg_rating !== null
                  ? `${overview.totals.total_avg_rating.toFixed(2)} ★`
                  : '—'}
              </div>
              <div className="mt-2 text-xs text-[#4a4338] tabular-nums space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Downloaded reviews / ratings</span>
                  <strong>{formatNumber(overview.totals.reviews_count)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Update events (all-time)</span>
                  <span>{formatNumber(overview.totals.update_events)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Crashes / ANRs (daily CSV)</span>
                  <span>
                    {formatNumber(overview.totals.total_crashes)} / {formatNumber(overview.totals.total_anrs)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs">
              <div className="flex items-center justify-between text-xs uppercase tracking-wider text-[#6e6558] font-medium">
                <span>Hourly Play Collector</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium normal-case ${
                    overview.sync.status === 'ok'
                      ? 'bg-[#1e4636]/12 text-[#1e4636]'
                      : 'bg-[#8d6b32]/15 text-[#725524]'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1e4636]" />
                  {overview.sync.status}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
                  {formatCountdown(overview.sync.next_scheduled_at, nowMs)}
                </span>
                <span className="text-xs text-[#6e6558]">until next sync</span>
              </div>
              <div className="mt-2 text-xs text-[#4a4338] tabular-nums space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Last sync</span>
                  <span>
                    {formatRelativeTime(overview.sync.last_polled_at, nowMs)} ({overview.sync.last_duration_ms}ms)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">Report range</span>
                  <span>
                    {overview.sync.first_report_date ?? '—'} → {overview.sync.latest_report_date ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6558]">GCS files tracked</span>
                  <span>
                    {overview.sync.synced_files_count} ({overview.sync.last_objects_updated} changed)
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
            />
          )}

          {/* Dimension Explorer (Country, Device, App Version, OS, Language, Carrier, Traffic Source) */}
          <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 shadow-xs overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#e7e0d2]">
              <div>
                <h2 className="text-lg font-medium text-[#1c1914]">
                  Play Console Breakdowns ({overview.window.from} → {overview.window.to})
                </h2>
                <p className="text-xs text-[#6e6558]">
                  All dimensions from Google Play export reports. Click a country row to filter the entire Play dashboard.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={dimSearch}
                  onChange={(e) => setDimSearch(e.target.value)}
                  placeholder="Filter dimension..."
                  className="w-44 rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 text-xs text-[#1c1914]"
                />
                <a
                  href={playCsvExportURL('countries', filters)}
                  className="rounded-full border border-[#d5cdb8] bg-[#f3eee4] px-3 py-1.5 text-xs font-medium text-[#1c1914] hover:border-[#8d6b32]"
                >
                  Countries CSV
                </a>
              </div>
            </div>

            <div className="px-5 pt-3 flex flex-wrap gap-1.5 border-b border-[#ece5d7] pb-3">
              {(
                [
                  ['country', `Countries (${overview.by_country.length})`],
                  ['device', `Devices (${overview.by_device.length})`],
                  ['app_version', `App Versions (${overview.by_app_version.length})`],
                  ['os_version', `Android OS (${overview.by_os_version.length})`],
                  ['language', `Languages (${overview.by_language.length})`],
                  ['carrier', `Carriers (${overview.by_carrier.length})`],
                  ['traffic_source', `Traffic Sources (${overview.by_traffic_source.length})`],
                ] as [PlayDimTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDimTab(id)}
                  className={`rounded-full px-3 py-1 text-xs cursor-pointer transition-colors ${
                    dimTab === id
                      ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                      : 'bg-[#f3eee4] text-[#4a4338] hover:text-[#1c1914]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              {dimTab === 'traffic_source' ? (
                <table className="w-full text-left border-collapse text-xs">
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
                    {overview.by_traffic_source.map((row, idx) => (
                      <tr key={idx} className="hover:bg-[#f3eee4]/60">
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
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
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
                        const isSelectedCountry =
                          dimTab === 'country' && filters.country === row.dimension_value;
                        return (
                          <tr
                            key={row.dimension_value || '_unknown'}
                            onClick={() => {
                              if (dimTab === 'country' && row.dimension_value) {
                                setFilters((p) => ({
                                  ...p,
                                  country: p.country === row.dimension_value ? '' : row.dimension_value,
                                }));
                              }
                            }}
                            className={`${
                              dimTab === 'country' ? 'cursor-pointer' : ''
                            } ${
                              isSelectedCountry ? 'bg-[#1e4636]/10' : 'hover:bg-[#f3eee4]/60'
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
              )}
            </div>
          </div>

          {/* Reviews, Tracks & Reporting API Vitals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Reviews & Tracks */}
            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs space-y-4">
              <div>
                <h3 className="text-base font-medium text-[#1c1914]">
                  Play Store Reviews &amp; Ratings ({reviews.length})
                </h3>
                <p className="text-xs text-[#6e6558]">Imported from reviews_*.csv in GCS</p>
              </div>

              {overview.tracks.length > 0 && (
                <div className="space-y-2">
                  {overview.tracks.map((tr) => (
                    <div
                      key={tr.track_name}
                      className="rounded-xl border border-[#d5cdb8] bg-[#f7f3ea] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#1c1914] uppercase tracking-wider text-[11px]">
                          {tr.track_name} · {tr.release_name || 'unnamed'}
                        </span>
                        <span className="rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[10px] font-medium text-[#1e4636]">
                          {tr.status} · code {tr.version_codes}
                        </span>
                      </div>
                      {tr.release_notes && (
                        <p className="mt-1.5 text-[#4a4338] line-clamp-2">{tr.release_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {reviews.length === 0 ? (
                  <div className="text-xs text-[#6e6558] py-6 text-center">No reviews recorded yet.</div>
                ) : (
                  reviews.map((rev) => (
                    <div
                      key={rev.review_key}
                      className="rounded-xl border border-[#e7e0d2] bg-[#fffcf6] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#8d6b32]">
                          {'★'.repeat(Math.max(0, rev.star_rating))}
                          {'☆'.repeat(Math.max(0, 5 - rev.star_rating))}
                        </span>
                        <span className="text-[#6e6558] tabular-nums">
                          {formatTimestamp(rev.submitted_at, filters.tz)} · v{rev.app_version_name || rev.app_version_code} ({rev.device || '—'})
                        </span>
                      </div>
                      {(rev.review_title || rev.review_text) ? (
                        <p className="mt-1.5 text-[#1c1914]">
                          {rev.review_title && <strong className="mr-1.5">{rev.review_title}</strong>}
                          {rev.review_text}
                        </p>
                      ) : (
                        <p className="mt-1 text-[#6e6558] italic">Star rating without written comment ({rev.reviewer_language || '—'})</p>
                      )}
                      {rev.reply_text && (
                        <p className="mt-1.5 pl-2.5 border-l-2 border-[#1e4636] text-[#4a4338]">
                          <strong>Developer reply:</strong> {rev.reply_text}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Reporting API Vitals */}
            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs space-y-3">
              <div>
                <h3 className="text-base font-medium text-[#1c1914]">
                  Play Developer Reporting Vitals (Hourly &amp; Daily)
                </h3>
                <p className="text-xs text-[#6e6558]">
                  Latest non-zero or recent hourly buckets from playdeveloperreporting.googleapis.com
                </p>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
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
                    {vitals.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[#6e6558]">
                          No Reporting API buckets stored yet.
                        </td>
                      </tr>
                    ) : (
                      vitals.slice(0, 80).map((v, idx) => (
                        <tr key={idx}>
                          <td className="py-2 pr-2 text-[#1c1914] whitespace-nowrap">
                            {formatTimestamp(v.bucket_start, filters.tz)}
                          </td>
                          <td className="py-2 px-2 font-mono text-[11px] text-[#4a4338]">{v.metric_set}</td>
                          <td className="py-2 px-2">
                            <span className="rounded bg-[#e7e0d2] px-1.5 py-0.5 text-[10px]">
                              {v.aggregation_period}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-[#6e6558]">{v.dimension_value || '—'}</td>
                          <td className="py-2 pl-2 text-right text-[#1c1914]">
                            {Object.entries(v.metrics || {})
                              .map(([k, val]) => `${k}: ${val}`)
                              .join(' · ')}
                          </td>
                        </tr>
                      ))
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
}

function PlayChart({ data, mode, onChangeMode, tz }: PlayChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(860);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
  const height = 290;
  const margin = { top: 18, right: 20, bottom: 36, left: 48 };
  const plotW = Math.max(200, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;

  const getVals = (p: PlayTimeSeriesPoint): [number, number, number] => {
    switch (mode) {
      case 'installs':
        return [p.device_installs, p.user_installs, p.user_uninstalls];
      case 'active':
        return [p.active_devices, 0, 0];
      case 'funnel':
        return [p.store_visitors, p.store_acquisitions, 0];
      case 'ratings':
        return [p.total_avg_rating ?? 0, p.crashes, p.anrs];
      case 'vitals':
        return [p.crashes, p.anrs, p.distinct_users];
    }
  };

  const maxVal = useMemo(() => {
    if (mode === 'ratings') return 5;
    let m = 0;
    for (const p of pts) {
      const [a, b, c] = getVals(p);
      m = Math.max(m, a, b, c);
    }
    return m <= 5 ? 5 : Math.ceil(m * 1.15);
  }, [pts, mode]);

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
  const xLabelEvery = pts.length <= 10 ? 1 : Math.ceil(pts.length / Math.max(4, Math.floor(plotW / 86)));

  const linePath = useMemo(() => {
    if (mode !== 'active' && mode !== 'ratings') return '';
    const valid = pts
      .map((p, idx) => ({ idx, val: mode === 'active' ? p.active_devices : p.total_avg_rating }))
      .filter((x) => x.val !== null && x.val !== undefined && (mode === 'active' || (x.val ?? 0) > 0));
    return valid
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xCenter(pt.idx).toFixed(1)} ${(margin.top + yScale(pt.val ?? 0)).toFixed(1)}`)
      .join(' ');
  }, [pts, mode, step, maxVal]);

  const hovered = hoverIdx !== null && pts[hoverIdx] ? pts[hoverIdx] : null;

  return (
    <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-medium text-[#1c1914]">
            {mode === 'installs' && 'Daily Device Installs, User Installs & Uninstalls'}
            {mode === 'active' && 'Active Device Installs'}
            {mode === 'funnel' && 'Store Listing Visitors & Acquisitions'}
            {mode === 'ratings' && 'Average Star Rating & Daily Crashes'}
            {mode === 'vitals' && 'Play Reporting Vitals (Hourly Crashes, ANRs & Distinct Users)'}
          </h2>
          <p className="text-xs text-[#6e6558]">
            {pts.length} buckets · Granularity: <strong>{data.granularity}</strong> · TZ:{' '}
            <strong>{data.timezone}</strong>
          </p>
        </div>

        <div className="inline-flex flex-wrap rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
          {(
            [
              ['installs', 'Installs'],
              ['active', 'Active Devices'],
              ['funnel', 'Store Funnel'],
              ['ratings', 'Rating'],
              ['vitals', 'Vitals'],
            ] as [PlayMetricMode, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeMode(id)}
              className={`rounded-full px-3 py-1 cursor-pointer transition-colors ${
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

      <div ref={containerRef} className="relative w-full select-none">
        <svg
          width={width}
          height={height}
          className="overflow-visible block"
          onMouseMove={(e) => {
            if (pts.length === 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = e.clientX - rect.left - margin.left;
            if (relX < 0 || relX > plotW) {
              setHoverIdx(null);
              return;
            }
            setHoverIdx(Math.min(pts.length - 1, Math.max(0, Math.floor(relX / step))));
          }}
          onMouseLeave={() => setHoverIdx(null)}
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
                  x={margin.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[#6e6558] text-[11px] tabular-nums"
                >
                  {formatNumber(tick)}
                </text>
              </g>
            );
          })}

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
              if (mode === 'installs') {
                const subW = Math.max(1.5, barW / 2);
                const h1 = (p.device_installs / maxVal) * plotH;
                const h2 = (p.user_uninstalls / maxVal) * plotH;
                return (
                  <g key={idx}>
                    {p.device_installs > 0 && (
                      <rect
                        x={cx - subW - 0.5}
                        y={margin.top + plotH - h1}
                        width={subW}
                        height={Math.max(1.5, h1)}
                        fill="#1e4636"
                        rx={1}
                      />
                    )}
                    {p.user_uninstalls > 0 && (
                      <rect
                        x={cx + 0.5}
                        y={margin.top + plotH - h2}
                        width={subW}
                        height={Math.max(1.5, h2)}
                        fill="#a4513a"
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
                    {p.store_visitors > 0 && (
                      <rect
                        x={cx - subW - 0.5}
                        y={margin.top + plotH - h1}
                        width={subW}
                        height={Math.max(1.5, h1)}
                        fill="#8d6b32"
                        rx={1}
                      />
                    )}
                    {p.store_acquisitions > 0 && (
                      <rect
                        x={cx + 0.5}
                        y={margin.top + plotH - h2}
                        width={subW}
                        height={Math.max(1.5, h2)}
                        fill="#1e4636"
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
                  {p.distinct_users > 0 && (
                    <rect
                      x={cx - barW / 2}
                      y={margin.top + plotH - hUsr}
                      width={barW}
                      height={Math.max(1.5, hUsr)}
                      fill="#2b6b74"
                      fillOpacity={0.35}
                      rx={1}
                    />
                  )}
                  {p.crashes > 0 && (
                    <rect
                      x={cx - barW / 2}
                      y={margin.top + plotH - hCrash}
                      width={barW}
                      height={Math.max(2, hCrash)}
                      fill="#a4513a"
                      rx={1}
                    />
                  )}
                </g>
              );
            })}

          {(mode === 'active' || mode === 'ratings') && linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={mode === 'ratings' ? '#8d6b32' : '#1e4636'}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {pts.map((p, idx) => {
            if (idx % xLabelEvery !== 0 && idx !== pts.length - 1) return null;
            return (
              <text
                key={idx}
                x={xCenter(idx)}
                y={height - 10}
                textAnchor="middle"
                className="fill-[#6e6558] text-[11px] tabular-nums"
              >
                {p.label}
              </text>
            );
          })}
        </svg>

        {hovered && hoverIdx !== null && (
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
