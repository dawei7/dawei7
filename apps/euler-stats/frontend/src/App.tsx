import { useEffect, useMemo, useState } from 'react';
import {
  csvExportURL,
  fetchAssets,
  fetchOverview,
  fetchPolls,
  fetchTimeSeries,
} from './lib/api';
import type {
  AssetRow,
  FilterState,
  Granularity,
  GroupBy,
  MetricMode,
  OverviewResponse,
  PollRunRow,
  RangePreset,
  TimeSeriesResponse,
} from './lib/types';
import { formatRelativeTime, seriesLabel } from './lib/format';
import { KpiCards } from './components/KpiCards';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { ActivityHeatmap } from './components/ActivityHeatmap';
import { BreakdownsGrid } from './components/BreakdownsGrid';
import { AssetTable, type SortField } from './components/AssetTable';
import { AssetDetailModal } from './components/AssetDetailModal';
import { PollLogTab } from './components/PollLogTab';
import { RoadmapTab } from './components/RoadmapTab';

type MainTab = 'library' | 'polls' | 'roadmap';

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zurich';
  } catch {
    return 'Europe/Zurich';
  }
}

export default function App() {
  const [tab, setTab] = useState<MainTab>('library');
  const [metric, setMetric] = useState<MetricMode>('delta');
  const [sort, setSort] = useState<SortField>('all_time_downloads');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);

  const [filters, setFilters] = useState<FilterState>(() => ({
    granularity: 'hour',
    groupBy: 'release',
    range: '48h',
    from: '',
    to: '',
    tz: defaultTimezone(),
    release: '',
    category: '',
    subject: '',
    language: '',
    edition: '',
    search: '',
  }));

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [ts, setTs] = useState<TimeSeriesResponse | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [polls, setPolls] = useState<PollRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const firstPolledAt = overview?.poller.first_polled_at ?? null;

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');

    Promise.all([
      fetchOverview(filters, ac.signal),
      fetchTimeSeries(filters, undefined, ac.signal),
      fetchAssets(filters, sort, dir, ac.signal),
    ])
      .then(([ov, series, assetList]) => {
        setOverview(ov);
        setTs(series);
        setAssets(assetList);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to load analytics');
        }
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [filters, sort, dir, refreshTick]);

  useEffect(() => {
    if (tab !== 'polls') return;
    const ac = new AbortController();
    fetchPolls(80, ac.signal)
      .then(setPolls)
      .catch(() => {});
    return () => ac.abort();
  }, [tab, refreshTick]);

  // Auto-refresh UI every 5 minutes so newly completed top-of-hour polls appear automatically.
  useEffect(() => {
    const id = window.setInterval(() => setRefreshTick((n) => n + 1), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const hasActiveFilters = Boolean(
    filters.release ||
      filters.category ||
      filters.subject ||
      filters.language ||
      filters.edition ||
      filters.search.trim(),
  );

  const tzOptions = useMemo(() => {
    const local = defaultTimezone();
    const list = [local, 'Europe/Zurich', 'UTC', 'America/New_York', 'Asia/Tokyo'];
    return Array.from(new Set(list));
  }, []);

  const handleGranularity = (g: Granularity) => {
    setFilters((prev) => {
      let nextRange = prev.range;
      if (g === 'hour' && (prev.range === '30d' || prev.range === '90d')) nextRange = '48h';
      if (g === '6h' && (prev.range === '24h' || prev.range === '90d')) nextRange = '7d';
      if (g === 'day' && (prev.range === '24h' || prev.range === '48h')) nextRange = '30d';
      if ((g === 'week' || g === 'month') && (prev.range === '24h' || prev.range === '48h' || prev.range === '7d')) {
        nextRange = '90d';
      }
      return { ...prev, granularity: g, range: nextRange };
    });
  };

  const handleSort = (field: SortField) => {
    if (sort === field) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(field);
      setDir(field === 'display_title' ? 'asc' : 'desc');
    }
  };

  const handleSelectBreakdown = (
    kind: 'release' | 'subject' | 'language' | 'edition',
    value: string,
  ) => {
    setFilters((prev) => ({
      ...prev,
      [kind]: prev[kind] === value ? '' : value,
    }));
  };

  const resetFilters = () => {
    setFilters((prev) => ({
      ...prev,
      release: '',
      category: '',
      subject: '',
      language: '',
      edition: '',
      search: '',
    }));
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 flex-1 pb-12">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d5cdb8] py-5">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-serif-euler text-2xl text-[#1c1914] tracking-tight">
                Professor Euler · Statistics
              </span>
              <span className="hidden sm:inline-block rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-0.5 text-xs font-serif-euler text-[#1e4636]">
                e<sup>iπ</sup> + 1 = 0
              </span>
            </div>
            <p className="text-xs text-[#6e6558] mt-0.5">
              Live release download analytics for{' '}
              <a
                href="https://github.com/dawei7/professor-euler-library/releases"
                target="_blank"
                rel="noreferrer"
                className="text-[#1e4636] underline hover:text-[#143028]"
              >
                dawei7/professor-euler-library
              </a>{' '}
              ·{' '}
              <a
                href="https://euler.dawei7.com"
                target="_blank"
                rel="noreferrer"
                className="text-[#1e4636] underline hover:text-[#143028]"
              >
                euler.dawei7.com
              </a>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {overview && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1 text-xs text-[#4a4338]">
                <span
                  className={`h-2 w-2 rounded-full ${
                    overview.poller.status === 'ok' ? 'bg-[#1e4636]' : 'bg-[#8d6b32]'
                  }`}
                />
                Last poll {formatRelativeTime(overview.poller.last_polled_at)}
              </span>
            )}
            <button
              type="button"
              onClick={() => setRefreshTick((n) => n + 1)}
              className="rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1 text-xs font-medium text-[#1c1914] hover:border-[#1e4636] transition-colors cursor-pointer"
            >
              Refresh View
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#fffcf6]/80 p-1 text-xs">
            {(
              [
                ['library', 'Library & Curriculum Downloads'],
                ['polls', 'Hourly Collector Log'],
                ['roadmap', 'Countries & App Roadmap'],
              ] as [MainTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-full px-4 py-1.5 cursor-pointer transition-colors ${
                  tab === id
                    ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                    : 'text-[#4a4338] hover:text-[#1c1914]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'library' && (
            <div className="flex items-center gap-2 text-xs">
              <a
                href={csvExportURL('timeseries', filters)}
                className="rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 font-medium text-[#4a4338] hover:text-[#1c1914] hover:border-[#8d6b32] transition-colors"
              >
                Export Time-Series CSV
              </a>
            </div>
          )}
        </nav>

        {error && (
          <div className="mb-4 rounded-xl border border-[#a4513a]/40 bg-[#a4513a]/10 px-4 py-3 text-sm text-[#a4513a]">
            {error}
          </div>
        )}

        {tab === 'library' && (
          <div className="space-y-5">
            {/* Granularity & Filter Bar */}
            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Granularity */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium mr-1">
                    Granularity
                  </span>
                  <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
                    {(
                      [
                        ['hour', 'Hourly'],
                        ['6h', '6 Hours'],
                        ['day', 'Daily'],
                        ['week', 'Weekly'],
                        ['month', 'Monthly'],
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

                {/* Window Presets */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium mr-1">
                    Window
                  </span>
                  <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
                    {(['24h', '48h', '7d', '30d', '90d', 'all', 'custom'] as RangePreset[]).map((r) => (
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

                {/* Group By */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium">
                    Stack by
                  </span>
                  <select
                    value={filters.groupBy}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, groupBy: e.target.value as GroupBy }))
                    }
                    className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
                  >
                    <option value="release">Release (Curriculum / Books)</option>
                    <option value="language">Language (EN / DE)</option>
                    <option value="edition">Edition (Tablet / Phone)</option>
                    <option value="none">Total Combined</option>
                  </select>
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

              {/* Dimension Filters */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#ece5d7] text-xs">
                <input
                  type="search"
                  value={filters.search}
                  onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                  placeholder="Search workbook, book, author..."
                  className="w-56 rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 text-xs text-[#1c1914] placeholder:text-[#8d8475] focus:outline-none focus:border-[#1e4636]"
                />

                <select
                  value={filters.release}
                  onChange={(e) => setFilters((p) => ({ ...p, release: e.target.value }))}
                  className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
                >
                  <option value="">All Releases</option>
                  {(overview?.filters.releases ?? ['curriculum', 'books']).map((r) => (
                    <option key={r} value={r}>
                      {seriesLabel(r)}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.subject}
                  onChange={(e) => setFilters((p) => ({ ...p, subject: e.target.value }))}
                  className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
                >
                  <option value="">All Subjects</option>
                  {(overview?.filters.subjects ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.language}
                  onChange={(e) => setFilters((p) => ({ ...p, language: e.target.value }))}
                  className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
                >
                  <option value="">All Languages</option>
                  {(overview?.filters.languages ?? ['en', 'de', 'all']).map((l) => (
                    <option key={l} value={l}>
                      {seriesLabel(l)}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.edition}
                  onChange={(e) => setFilters((p) => ({ ...p, edition: e.target.value }))}
                  className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
                >
                  <option value="">All Editions</option>
                  {(overview?.filters.editions ?? ['tablet', 'phone', 'all']).map((ed) => (
                    <option key={ed} value={ed}>
                      {ed}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.tz}
                  onChange={(e) => setFilters((p) => ({ ...p, tz: e.target.value }))}
                  className="ml-auto rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-xs text-[#1c1914]"
                  title="Display timezone"
                >
                  {tzOptions.map((tz) => (
                    <option key={tz} value={tz}>
                      TZ: {tz}
                    </option>
                  ))}
                </select>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-lg border border-[#a4513a]/40 bg-[#a4513a]/10 px-2.5 py-1.5 text-xs font-medium text-[#a4513a] hover:bg-[#a4513a]/20 cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {loading && !overview ? (
              <div className="py-16 text-center text-sm text-[#6e6558]">
                Loading Professor Euler release statistics...
              </div>
            ) : (
              <>
                {overview && <KpiCards overview={overview} tz={filters.tz} />}

                {ts && overview && (
                  <TimeSeriesChart
                    data={ts}
                    metric={metric}
                    onChangeMetric={setMetric}
                    firstPolledAt={overview.poller.first_polled_at}
                    baselineTotal={overview.all_time.baseline_downloads}
                    tz={filters.tz}
                  />
                )}

                {ts && overview && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <ActivityHeatmap
                      hourlyProfile={ts.hourly_profile}
                      matrix={ts.activity_matrix}
                      tz={filters.tz}
                    />
                    <BreakdownsGrid
                      overview={overview}
                      onSelectFilter={handleSelectBreakdown}
                    />
                  </div>
                )}

                <AssetTable
                  assets={assets}
                  sort={sort}
                  dir={dir}
                  onSort={handleSort}
                  onSelectAsset={setSelectedAsset}
                  csvUrl={csvExportURL('assets', filters)}
                />
              </>
            )}
          </div>
        )}

        {tab === 'polls' && (
          <PollLogTab polls={polls} poller={overview?.poller ?? null} tz={filters.tz} />
        )}

        {tab === 'roadmap' && <RoadmapTab />}
      </div>

      <footer className="border-t border-[#d5cdb8] py-5 text-xs text-[#6e6558]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-wrap justify-between gap-2">
          <span>Professor Euler Statistics · euler-stats.dawei7.com</span>
          <span>
            Polled hourly from GitHub Releases · Stored in PostgreSQL · Zero user telemetry
          </span>
        </div>
      </footer>

      {selectedAsset && (
        <AssetDetailModal
          asset={selectedAsset}
          filters={filters}
          firstPolledAt={firstPolledAt}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}
