import { useEffect, useState } from 'react';
import type { OverviewResponse } from '../lib/types';
import {
  formatBytes,
  formatCountdown,
  formatNumber,
  formatRelativeTime,
  formatTimestamp,
} from '../lib/format';

interface KpiCardsProps {
  overview: OverviewResponse;
  tz: string;
}

export function KpiCards({ overview, tz }: KpiCardsProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { all_time, window: win, poller, by_language, by_edition } = overview;

  const enItem = by_language.find((x) => x.key === 'en');
  const deItem = by_language.find((x) => x.key === 'de');
  const langTotal = (enItem?.all_time_downloads ?? 0) + (deItem?.all_time_downloads ?? 0);
  const enPct = langTotal > 0 ? Math.round(((enItem?.all_time_downloads ?? 0) / langTotal) * 100) : 0;

  const tabletItem = by_edition.find((x) => x.key === 'tablet');
  const phoneItem = by_edition.find((x) => x.key === 'phone');
  const edTotal = (tabletItem?.all_time_downloads ?? 0) + (phoneItem?.all_time_downloads ?? 0);
  const tabletPct = edTotal > 0 ? Math.round(((tabletItem?.all_time_downloads ?? 0) / edTotal) * 100) : 0;

  const isHealthy = poller.status === 'ok';

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-4">
      {/* 1. All-time downloads */}
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between gap-1 text-[10px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
          <span className="truncate">All-Time Downloads</span>
          <span className="shrink-0 rounded-full bg-[#e7e0d2] px-2 py-0.5 text-[10px] sm:text-[11px] text-[#4a4338] normal-case tracking-normal">
            {all_time.active_assets}
          </span>
        </div>
        <div className="mt-1.5 sm:mt-2 text-2xl sm:text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
          {formatNumber(all_time.total_downloads)}
        </div>
        <div className="mt-2 sm:mt-3 flex flex-wrap gap-1.5 text-[11px] sm:text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#1e4636]/10 px-2 py-0.5 text-[#1e4636] font-medium tabular-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1e4636]" />
            Curr: {formatNumber(all_time.curriculum_downloads)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#8d6b32]/12 px-2 py-0.5 text-[#725524] font-medium tabular-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-[#8d6b32]" />
            Books: {formatNumber(all_time.books_downloads)}
          </span>
        </div>
        <div className="mt-2 text-[11px] text-[#6e6558] tabular-nums hidden sm:block">
          Catalog payload: {formatBytes(all_time.total_bytes)}
        </div>
      </div>

      {/* 2. Selected Window Delta */}
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between gap-1 text-[10px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
          <span className="truncate">Window New</span>
          {win.change_pct !== null && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                win.change_pct >= 0
                  ? 'bg-[#1e4636]/12 text-[#1e4636]'
                  : 'bg-[#a4513a]/12 text-[#a4513a]'
              }`}
            >
              {win.change_pct >= 0 ? '+' : ''}
              {win.change_pct.toFixed(0)}%
            </span>
          )}
        </div>
        <div className="mt-1.5 sm:mt-2 text-2xl sm:text-3xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
          +{formatNumber(win.delta_downloads)}
        </div>
        <div className="mt-2 sm:mt-3 grid grid-cols-2 gap-1.5 text-[11px] sm:text-xs text-[#4a4338] tabular-nums">
          <div className="rounded-lg bg-[#f3eee4] px-2 py-1">
            <span className="block text-[10px] text-[#6e6558]">/ hour</span>
            <span className="font-semibold text-[#1c1914]">{win.avg_per_hour.toFixed(2)}</span>
          </div>
          <div className="rounded-lg bg-[#f3eee4] px-2 py-1">
            <span className="block text-[10px] text-[#6e6558]">/ day</span>
            <span className="font-semibold text-[#1c1914]">{win.avg_per_day.toFixed(1)}</span>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-[#6e6558] tabular-nums hidden sm:block">
          {win.active_assets_used} distinct assets downloaded in window
        </div>
      </div>

      {/* 3. Language & Device Split */}
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs">
        <div className="text-[10px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
          Language &amp; Device
        </div>
        <div className="mt-2 space-y-2.5">
          <div>
            <div className="flex justify-between text-[11px] sm:text-xs text-[#4a4338] mb-1 tabular-nums">
              <span>EN ({formatNumber(enItem?.all_time_downloads ?? 0)})</span>
              <span>DE ({formatNumber(deItem?.all_time_downloads ?? 0)})</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#e7e0d2] overflow-hidden flex">
              <div className="bg-[#1e4636] h-full" style={{ width: `${enPct}%` }} />
              <div className="bg-[#8d6b32] h-full" style={{ width: `${100 - enPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[11px] sm:text-xs text-[#4a4338] mb-1 tabular-nums">
              <span>Tab ({formatNumber(tabletItem?.all_time_downloads ?? 0)})</span>
              <span>Phn ({formatNumber(phoneItem?.all_time_downloads ?? 0)})</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#e7e0d2] overflow-hidden flex">
              <div className="bg-[#1e4636] h-full" style={{ width: `${tabletPct}%` }} />
              <div className="bg-[#2b6b74] h-full" style={{ width: `${100 - tabletPct}%` }} />
            </div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-[#6e6558] hidden sm:block">
          Tracked delta: +{formatNumber(all_time.tracked_delta)} (base {formatNumber(all_time.baseline_downloads)})
        </div>
      </div>

      {/* 4. Hourly Collector Health */}
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between gap-1 text-[10px] sm:text-xs uppercase tracking-wider text-[#6e6558] font-medium">
          <span className="truncate">GitHub Poller</span>
          <span
            className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium normal-case ${
              isHealthy
                ? 'bg-[#1e4636]/12 text-[#1e4636]'
                : 'bg-[#a4513a]/15 text-[#a4513a]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isHealthy ? 'bg-[#1e4636] animate-pulse' : 'bg-[#a4513a]'
              }`}
            />
            {isHealthy ? '1h' : poller.status}
          </span>
        </div>
        <div className="mt-1.5 sm:mt-2 flex items-baseline justify-between gap-1">
          <span className="text-xl sm:text-2xl font-semibold text-[#1c1914] tabular-nums font-serif-euler">
            {formatCountdown(poller.next_scheduled_at, nowMs)}
          </span>
          <span className="text-[11px] text-[#6e6558]">next poll</span>
        </div>
        <div className="mt-2 space-y-1 text-[11px] sm:text-xs text-[#4a4338] tabular-nums">
          <div className="flex justify-between gap-1">
            <span className="text-[#6e6558]">Last</span>
            <span className="truncate">{formatRelativeTime(poller.last_polled_at, nowMs)}</span>
          </div>
          <div className="hidden sm:flex justify-between gap-1">
            <span className="text-[#6e6558]">Since</span>
            <span>{formatTimestamp(poller.first_polled_at, tz)}</span>
          </div>
          <div className="flex justify-between gap-1">
            <span className="text-[#6e6558]">Runs</span>
            <span>
              {poller.successful_polls}/{poller.total_polls} ok
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
