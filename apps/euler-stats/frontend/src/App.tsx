import { useEffect, useMemo, useState } from 'react';
import {
  csvExportURL,
  fetchAssets,
  fetchNotifications,
  fetchOverview,
  fetchPlayOverview,
  fetchPlayPolls,
  fetchPolls,
  fetchTimeSeries,
} from './lib/api';
import type {
  AssetMode,
  AssetRow,
  FilterState,
  Granularity,
  GroupBy,
  MetricMode,
  NotificationStatusResponse,
  OverviewResponse,
  PlayOverviewResponse,
  PlayPollRunRow,
  PollRunRow,
  RangePreset,
  TimeRangeSelection,
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
import { GooglePlayTab } from './components/GooglePlayTab';
import { SelectionsBar, type SelectionChip } from './components/SelectionsBar';
import { useInstallPrompt } from './lib/useInstallPrompt';

type MainTab = 'play' | 'library' | 'polls';

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zurich';
  } catch {
    return 'Europe/Zurich';
  }
}

export default function App() {
  const [tab, setTab] = useState<MainTab>('play');
  const [metric, setMetric] = useState<MetricMode>('delta');
  const [assetMode, setAssetMode] = useState<AssetMode>('items');
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
    itemKey: '',
    itemTitle: '',
    hour: null,
    dow: null,
  }));
  const [chartTime, setChartTime] = useState<TimeRangeSelection | null>(null);
  const [showAllInSlice, setShowAllInSlice] = useState(false);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [ts, setTs] = useState<TimeSeriesResponse | null>(null);
  const [sliceTs, setSliceTs] = useState<TimeSeriesResponse | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [polls, setPolls] = useState<PollRunRow[]>([]);
  const [playPolls, setPlayPolls] = useState<PlayPollRunRow[]>([]);
  const [playOverviewSummary, setPlayOverviewSummary] = useState<PlayOverviewResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const { canInstall, showIOSTip, promptInstall } = useInstallPrompt();
  const [installDismissed, setInstallDismissed] = useState(false);
  const [iosTipDismissed, setIosTipDismissed] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const firstPolledAt = overview?.poller.first_polled_at ?? null;

  const effectiveFilters = useMemo<FilterState>(
    () =>
      chartTime
        ? { ...filters, range: 'custom', from: chartTime.from, to: chartTime.to }
        : filters,
    [filters, chartTime],
  );

  // Parent TimeSeries keeps the full window visible while selected bar(s) highlight in Qlik green.
  useEffect(() => {
    if (tab !== 'library' && tab !== 'polls') return;
    const ac = new AbortController();
    fetchTimeSeries(filters, undefined, ac.signal)
      .then((series) => setTs(series))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to load time series');
        }
      });
    return () => ac.abort();
  }, [tab, filters, refreshTick]);

  // Overview + AssetTable (and heatmap when time-sliced) reflect the effective slice.
  useEffect(() => {
    if (tab !== 'library' && tab !== 'polls') return;
    const ac = new AbortController();
    setLoading(true);
    setError('');

    Promise.all([
      fetchOverview(effectiveFilters, ac.signal),
      fetchAssets(effectiveFilters, assetMode, sort, dir, ac.signal),
      chartTime ? fetchTimeSeries(effectiveFilters, undefined, ac.signal) : Promise.resolve(null),
    ])
      .then(([ov, assetList, slicedSeries]) => {
        setOverview(ov);
        setAssets(assetList);
        setSliceTs(slicedSeries);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to load analytics');
        }
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [tab, effectiveFilters, assetMode, sort, dir, refreshTick, chartTime]);

  useEffect(() => {
    if (tab !== 'polls') return;
    const ac = new AbortController();
    Promise.all([
      fetchPolls(80, ac.signal),
      fetchPlayPolls(80, ac.signal),
      fetchPlayOverview(
        { granularity: 'day', range: '30d', from: '', to: '', tz: filters.tz, dimType: '', dimValue: '' },
        ac.signal,
      ),
      fetchNotifications(40, ac.signal),
    ])
      .then(([ghPolls, pPolls, pOv, notif]) => {
        setPolls(ghPolls);
        setPlayPolls(pPolls);
        setPlayOverviewSummary(pOv);
        setNotifications(notif);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [tab, filters.tz, refreshTick]);

  // Auto-refresh UI every 5 minutes so newly completed top-of-hour polls appear automatically.
  useEffect(() => {
    const id = window.setInterval(() => setRefreshTick((n) => n + 1), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const hasActiveFilters = Boolean(
    chartTime ||
      filters.hour !== null ||
      filters.dow !== null ||
      filters.release ||
      filters.category ||
      filters.subject ||
      filters.language ||
      filters.edition ||
      filters.itemKey ||
      filters.search.trim(),
  );

  const activeDropdownFilterCount = [
    filters.release,
    filters.category,
    filters.subject,
    filters.language,
    filters.edition,
  ].filter(Boolean).length;

  const tzOptions = useMemo(() => {
    const local = defaultTimezone();
    const list = [local, 'Europe/Zurich', 'UTC', 'America/New_York', 'Asia/Tokyo'];
    return Array.from(new Set(list));
  }, []);

  const handleGranularity = (g: Granularity) => {
    setChartTime(null);
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
    kind: 'release' | 'category' | 'subject' | 'language' | 'edition',
    value: string,
  ) => {
    setFilters((prev) => ({
      ...prev,
      [kind]: prev[kind] === value ? '' : value,
    }));
  };

  const handleToggleLegendSeries = (key: string) => {
    if (filters.groupBy === 'release') handleSelectBreakdown('release', key);
    else if (filters.groupBy === 'language') handleSelectBreakdown('language', key);
    else if (filters.groupBy === 'edition') handleSelectBreakdown('edition', key);
  };

  const handleSelectCell = (dow: number, hr: number) => {
    setFilters((prev) =>
      prev.dow === dow && prev.hour === hr
        ? { ...prev, dow: null, hour: null }
        : { ...prev, dow, hour: hr },
    );
  };

  const handleToggleItemFilter = (asset: AssetRow) => {
    setFilters((prev) =>
      prev.itemKey === asset.item_key
        ? { ...prev, itemKey: '', itemTitle: '' }
        : { ...prev, itemKey: asset.item_key, itemTitle: asset.display_title },
    );
  };

  const resetFilters = () => {
    setChartTime(null);
    setShowAllInSlice(false);
    setFilters((prev) => ({
      ...prev,
      release: '',
      category: '',
      subject: '',
      language: '',
      edition: '',
      search: '',
      itemKey: '',
      itemTitle: '',
      hour: null,
      dow: null,
    }));
  };

  const hasSliceFilter = Boolean(chartTime || filters.hour !== null || filters.dow !== null);
  const displayedAssets = useMemo(() => {
    if (!hasSliceFilter || showAllInSlice) return assets;
    return assets.filter((a) => a.window_delta > 0);
  }, [assets, hasSliceFilter, showAllInSlice]);

  const selectionChips: SelectionChip[] = useMemo(() => {
    const dowLabels = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const chips: SelectionChip[] = [];
    if (chartTime) {
      chips.push({
        key: 'chartTime',
        label: 'Time Slice',
        value: chartTime.label,
        onClear: () => setChartTime(null),
      });
    }
    if (filters.dow !== null) {
      chips.push({
        key: 'dow',
        label: 'Weekday',
        value: dowLabels[filters.dow] ?? String(filters.dow),
        onClear: () => setFilters((p) => ({ ...p, dow: null })),
      });
    }
    if (filters.hour !== null) {
      chips.push({
        key: 'hour',
        label: 'Hour',
        value: `${String(filters.hour).padStart(2, '0')}:00`,
        onClear: () => setFilters((p) => ({ ...p, hour: null })),
      });
    }
    if (filters.release) {
      chips.push({
        key: 'release',
        label: 'Release',
        value: seriesLabel(filters.release),
        onClear: () => setFilters((p) => ({ ...p, release: '' })),
      });
    }
    if (filters.category) {
      chips.push({
        key: 'category',
        label: 'Category',
        value: filters.category,
        onClear: () => setFilters((p) => ({ ...p, category: '' })),
      });
    }
    if (filters.subject) {
      chips.push({
        key: 'subject',
        label: 'Subject',
        value: filters.subject,
        onClear: () => setFilters((p) => ({ ...p, subject: '' })),
      });
    }
    if (filters.language) {
      chips.push({
        key: 'language',
        label: 'Language',
        value: seriesLabel(filters.language),
        onClear: () => setFilters((p) => ({ ...p, language: '' })),
      });
    }
    if (filters.edition) {
      chips.push({
        key: 'edition',
        label: 'Edition',
        value: seriesLabel(filters.edition),
        onClear: () => setFilters((p) => ({ ...p, edition: '' })),
      });
    }
    if (filters.itemKey) {
      chips.push({
        key: 'itemKey',
        label: 'Item',
        value: filters.itemTitle || filters.itemKey,
        onClear: () => setFilters((p) => ({ ...p, itemKey: '', itemTitle: '' })),
      });
    }
    if (filters.search.trim()) {
      chips.push({
        key: 'search',
        label: 'Search',
        value: filters.search.trim(),
        onClear: () => setFilters((p) => ({ ...p, search: '' })),
      });
    }
    return chips;
  }, [chartTime, filters]);

  const legendKeys = useMemo(() => {
    if (!overview) return undefined;
    if (filters.groupBy === 'release') return overview.filters.releases;
    if (filters.groupBy === 'language') return overview.filters.languages;
    if (filters.groupBy === 'edition') return overview.filters.editions;
    return undefined;
  }, [overview, filters.groupBy]);

  const activeLegendSeries =
    filters.groupBy === 'release'
      ? filters.release
      : filters.groupBy === 'language'
        ? filters.language
        : filters.groupBy === 'edition'
          ? filters.edition
          : '';

  const switchTab = (next: MainTab) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-3.5 sm:px-6 lg:px-8 flex-1 pb-24 md:pb-12">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 border-b border-[#d5cdb8] py-3.5 sm:py-5 safe-pt">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="font-serif-euler text-xl sm:text-2xl text-[#1c1914] tracking-tight truncate">
                Professor Euler · <span className="sm:hidden">Stats</span>
                <span className="hidden sm:inline">Statistics</span>
              </span>
              <span className="hidden sm:inline-block rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-0.5 text-xs font-serif-euler text-[#1e4636]">
                e<sup>iπ</sup> + 1 = 0
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-[#6e6558] mt-0.5 truncate sm:whitespace-normal">
              <span className="sm:hidden">Google Play &amp; Library Analytics</span>
              <span className="hidden sm:inline">
                Android app telemetry via{' '}
                <a
                  href="https://play.google.com/store/apps/details?id=com.mathn.tablet"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#1e4636] underline hover:text-[#143028]"
                >
                  Google Play (com.mathn.tablet)
                </a>{' '}
                &amp;{' '}
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
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canInstall && (
              <button
                type="button"
                onClick={() => void promptInstall()}
                className="rounded-full bg-[#1e4636] px-3 py-1.5 sm:py-1 text-xs font-medium text-[#faf7f1] hover:bg-[#143028] transition-colors cursor-pointer"
              >
                Install App
              </button>
            )}
            {overview && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1 text-xs text-[#4a4338]">
                <span
                  className={`h-2 w-2 rounded-full ${
                    overview.poller.status === 'ok' ? 'bg-[#1e4636]' : 'bg-[#8d6b32]'
                  }`}
                />
                GitHub {formatRelativeTime(overview.poller.last_polled_at)}
              </span>
            )}
            <button
              type="button"
              onClick={() => setRefreshTick((n) => n + 1)}
              className="rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 sm:py-1 text-xs font-medium text-[#1c1914] hover:border-[#1e4636] transition-colors cursor-pointer"
            >
              <span className="sm:hidden">Refresh</span>
              <span className="hidden sm:inline">Refresh View</span>
            </button>
          </div>
        </header>

        {/* Mobile Install Prompts (Android Chromium or iOS Safari) */}
        {canInstall && !installDismissed && (
          <div className="mt-3 sm:hidden rounded-xl border border-[#1e4636]/30 bg-[#1e4636]/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
            <span className="text-[#1c1914]">
              <strong>Install Euler Stats</strong> on your home screen for full-screen mobile viewing.
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void promptInstall()}
                className="rounded-full bg-[#1e4636] px-3 py-1 font-medium text-[#faf7f1]"
              >
                Install
              </button>
              <button
                type="button"
                onClick={() => setInstallDismissed(true)}
                aria-label="Dismiss install hint"
                className="px-1.5 py-1 text-[#6e6558]"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {showIOSTip && !iosTipDismissed && (
          <div className="mt-3 rounded-xl border border-[#8d6b32]/35 bg-[#8d6b32]/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-[#4a4338]">
            <span>
              <strong>Install on iPhone/iPad:</strong> tap <strong>Share</strong> in Safari, then choose{' '}
              <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
            </span>
            <button
              type="button"
              onClick={() => setIosTipDismissed(true)}
              aria-label="Dismiss iOS install hint"
              className="px-1.5 py-1 text-[#6e6558] shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        {/* Desktop & Tablet Navigation Tabs */}
        <nav className="hidden md:flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="inline-flex flex-wrap rounded-full border border-[#d5cdb8] bg-[#fffcf6]/80 p-1 text-xs">
            {(
              [
                ['play', 'Google Play Store'],
                ['library', 'Library & Curriculum Releases'],
                ['polls', 'Alerts & Collector Log'],
              ] as [MainTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => switchTab(id)}
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
                href={csvExportURL('timeseries', effectiveFilters)}
                className="rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 font-medium text-[#4a4338] hover:text-[#1c1914] hover:border-[#8d6b32] transition-colors"
              >
                Export Time-Series CSV
              </a>
            </div>
          )}
        </nav>

        <div className="md:hidden h-3" />

        {error && tab !== 'play' && (
          <div className="mb-4 rounded-xl border border-[#a4513a]/40 bg-[#a4513a]/10 px-4 py-3 text-sm text-[#a4513a]">
            {error}
          </div>
        )}

        {tab === 'play' && (
          <GooglePlayTab
            defaultTz={defaultTimezone()}
            tzOptions={tzOptions}
            refreshTick={refreshTick}
            onOpenPolls={() => switchTab('polls')}
          />
        )}

        {tab === 'library' && (
          <div className="space-y-4 sm:space-y-5">
            {/* Granularity & Filter Bar */}
            <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
                {/* Granularity */}
                <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
                  <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium shrink-0">
                    Granularity
                  </span>
                  <div className="inline-flex overflow-x-auto no-scrollbar max-w-full rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
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

                {/* Window Presets */}
                <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
                  <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium shrink-0">
                    Window
                  </span>
                  <div className="inline-flex overflow-x-auto no-scrollbar max-w-full rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
                    {(['24h', '48h', '7d', '30d', '90d', 'all', 'custom'] as RangePreset[]).map((r) => (
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

                {/* Group By */}
                <div className="flex items-center gap-2 text-xs w-full sm:w-auto">
                  <span className="text-[11px] uppercase tracking-wider text-[#6e6558] font-medium shrink-0">
                    Stack by
                  </span>
                  <select
                    value={filters.groupBy}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, groupBy: e.target.value as GroupBy }))
                    }
                    className="flex-1 sm:flex-none rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
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
                      className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-sm sm:text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-[#4a4338]">
                    To:
                    <input
                      type="date"
                      value={filters.to}
                      onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
                      className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-sm sm:text-xs"
                    />
                  </label>
                </div>
              )}

              {/* Search + Mobile Filter Toggle + Dimension Filters */}
              <div className="pt-2 border-t border-[#ece5d7] space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="search"
                    value={filters.search}
                    onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                    placeholder="Search workbook, book, author..."
                    className="flex-1 sm:w-56 sm:flex-none rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 text-sm sm:text-xs text-[#1c1914] placeholder:text-[#8d8475] focus:outline-none focus:border-[#1e4636]"
                  />

                  <button
                    type="button"
                    onClick={() => setMobileFiltersOpen((v) => !v)}
                    className="sm:hidden rounded-lg border border-[#d5cdb8] bg-[#f3eee4] px-2.5 py-1.5 text-xs font-medium text-[#1c1914] shrink-0"
                  >
                    Filters{activeDropdownFilterCount > 0 ? ` (${activeDropdownFilterCount})` : ''}
                  </button>

                  <a
                    href={csvExportURL('timeseries', filters)}
                    className="sm:hidden rounded-lg border border-[#d5cdb8] bg-[#f3eee4] px-2.5 py-1.5 text-xs font-medium text-[#4a4338] shrink-0"
                  >
                    CSV
                  </a>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="sm:hidden rounded-lg border border-[#a4513a]/40 bg-[#a4513a]/10 px-2.5 py-1.5 text-xs font-medium text-[#a4513a]"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <div
                  className={`${
                    mobileFiltersOpen ? 'grid grid-cols-2' : 'hidden'
                  } sm:flex sm:flex-wrap items-center gap-2 text-xs`}
                >
                  <select
                    value={filters.release}
                    onChange={(e) => setFilters((p) => ({ ...p, release: e.target.value }))}
                    className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
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
                    className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
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
                    className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
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
                    className="rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
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
                    onChange={(e) => {
                      setChartTime(null);
                      setFilters((p) => ({ ...p, tz: e.target.value }));
                    }}
                    className="col-span-2 sm:col-span-1 sm:ml-auto rounded-lg border border-[#d5cdb8] bg-[#f7f3ea] px-2.5 py-1.5 text-sm sm:text-xs text-[#1c1914]"
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
                      className="hidden sm:inline-block rounded-lg border border-[#a4513a]/40 bg-[#a4513a]/10 px-2.5 py-1.5 text-xs font-medium text-[#a4513a] hover:bg-[#a4513a]/20 cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            <SelectionsBar
              chips={selectionChips}
              onClearAll={resetFilters}
              hint="Click or drag chart bars, click legend series, or tap heatmap & breakdown bars to cross-filter like Qlik."
            />

            {loading && !overview ? (
              <div className="py-16 text-center text-sm text-[#6e6558]">
                Loading Professor Euler release statistics...
              </div>
            ) : (
              <>
                {overview && (
                  <KpiCards
                    overview={overview}
                    tz={filters.tz}
                    selectedRelease={filters.release}
                    selectedLanguage={filters.language}
                    selectedEdition={filters.edition}
                    onToggleRelease={(rel) => handleSelectBreakdown('release', rel)}
                    onToggleLanguage={(lang) => handleSelectBreakdown('language', lang)}
                    onToggleEdition={(ed) => handleSelectBreakdown('edition', ed)}
                    onOpenPolls={() => switchTab('polls')}
                  />
                )}

                {ts && overview && (
                  <TimeSeriesChart
                    data={ts}
                    metric={metric}
                    onChangeMetric={setMetric}
                    firstPolledAt={overview.poller.first_polled_at}
                    baselineTotal={overview.all_time.baseline_downloads}
                    tz={filters.tz}
                    selectedRange={chartTime}
                    onSelectRange={setChartTime}
                    activeSeriesKey={activeLegendSeries}
                    legendKeys={legendKeys}
                    onToggleSeries={handleToggleLegendSeries}
                  />
                )}

                {(sliceTs || ts) && overview && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                    <ActivityHeatmap
                      hourlyProfile={(chartTime && sliceTs ? sliceTs : ts)!.hourly_profile}
                      matrix={(chartTime && sliceTs ? sliceTs : ts)!.activity_matrix}
                      tz={filters.tz}
                      selectedHour={filters.hour}
                      selectedDow={filters.dow}
                      onSelectHour={(hr) => setFilters((p) => ({ ...p, hour: hr }))}
                      onSelectDow={(dow) => setFilters((p) => ({ ...p, dow, hour: null }))}
                      onSelectCell={handleSelectCell}
                    />
                    <BreakdownsGrid
                      overview={overview}
                      selectedFilters={{
                        release: filters.release,
                        category: filters.category,
                        subject: filters.subject,
                        language: filters.language,
                        edition: filters.edition,
                      }}
                      onSelectFilter={handleSelectBreakdown}
                    />
                  </div>
                )}

                <AssetTable
                  assets={displayedAssets}
                  mode={assetMode}
                  onChangeMode={setAssetMode}
                  sort={sort}
                  dir={dir}
                  onSort={handleSort}
                  onSelectAsset={setSelectedAsset}
                  csvUrl={csvExportURL('assets', effectiveFilters, assetMode)}
                  sliceActive={hasSliceFilter}
                  totalMatchingCount={assets.length}
                  showAllInSlice={showAllInSlice}
                  onToggleShowAllInSlice={() => setShowAllInSlice((v) => !v)}
                  selectedItemKey={filters.itemKey}
                  selectedRelease={filters.release}
                  selectedSubject={filters.subject}
                  selectedLanguage={filters.language}
                  selectedEdition={filters.edition}
                  onToggleItemFilter={handleToggleItemFilter}
                  onToggleFacet={(facet, val) => handleSelectBreakdown(facet, val)}
                />
              </>
            )}
          </div>
        )}

        {tab === 'polls' && (
          <PollLogTab
            polls={polls}
            poller={overview?.poller ?? null}
            playPolls={playPolls}
            playSync={playOverviewSummary?.sync ?? null}
            notifications={notifications}
            onRefreshNotifications={() => setRefreshTick((n) => n + 1)}
            tz={filters.tz}
          />
        )}
      </div>

      <footer className="hidden md:block border-t border-[#d5cdb8] py-5 text-xs text-[#6e6558]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-wrap justify-between gap-2">
          <span>Professor Euler Statistics · euler-stats.dawei7.com</span>
          <span>
            Polled hourly from Google Play &amp; GitHub Releases · Stored in PostgreSQL
          </span>
        </div>
      </footer>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Primary sections"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#d5cdb8] bg-[#fffcf6]/95 backdrop-blur-md safe-pb"
      >
        <div className="grid grid-cols-3">
          {(
            [
              ['play', 'Play Store'],
              ['library', 'Library'],
              ['polls', 'Alerts & Log'],
            ] as [MainTab, string][]
          ).map(([id, label]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => switchTab(id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 min-h-[54px] text-[11px] font-medium transition-colors cursor-pointer ${
                  active ? 'text-[#1e4636]' : 'text-[#6e6558]'
                }`}
              >
                <span
                  className={`flex items-center justify-center rounded-full px-3.5 py-1 transition-colors ${
                    active ? 'bg-[#1e4636]/12' : ''
                  }`}
                >
                  {id === 'play' && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2}>
                      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {id === 'library' && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2}>
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  )}
                  {id === 'polls' && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2}>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {selectedAsset && (
        <AssetDetailModal
          asset={selectedAsset}
          mode={assetMode}
          filters={filters}
          firstPolledAt={firstPolledAt}
          isItemIsolated={filters.itemKey === selectedAsset.item_key}
          onIsolateInDashboard={handleToggleItemFilter}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}
