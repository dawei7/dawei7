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
  selectedRelease?: string;
  selectedLanguage?: string;
  selectedEdition?: string;
  onToggleRelease?: (release: string) => void;
  onToggleLanguage?: (language: string) => void;
  onToggleEdition?: (edition: string) => void;
  onOpenPolls?: () => void;
}

export function KpiCards({
  overview,
  tz,
  selectedRelease = '',
  selectedLanguage = '',
  selectedEdition = '',
  onToggleRelease,
  onToggleLanguage,
  onToggleEdition,
  onOpenPolls,
}: KpiCardsProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { all_time, window: win, poller, by_release, by_language, by_edition } = overview;

  const currItem = by_release.find((x) => x.key === 'curriculum');
  const booksItem = by_release.find((x) => x.key === 'books');
  const currDownloads = currItem?.all_time_downloads ?? all_time.curriculum_downloads;
  const booksDownloads = booksItem?.all_time_downloads ?? all_time.books_downloads;

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
          <button
            type="button"
            onClick={() => onToggleRelease?.('curriculum')}
            title="Filter by Curriculum release"
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tabular-nums cursor-pointer transition-all ${
              selectedRelease === 'curriculum'
                ? 'bg-[#1e4636] text-[#faf7f1] ring-1 ring-[#1e4636]'
                : selectedRelease
                  ? 'bg-[#e7e0d2]/70 text-[#6e6558] opacity-65 hover:opacity-100'
                  : 'bg-[#1e4636]/10 text-[#1e4636] hover:bg-[#1e4636]/20'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                selectedRelease === 'curriculum' ? 'bg-[#faf7f1]' : 'bg-[#1e4636]'
              }`}
            />
            Curr: {formatNumber(currDownloads)}
          </button>
          <button
            type="button"
            onClick={() => onToggleRelease?.('books')}
            title="Filter by Books release"
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tabular-nums cursor-pointer transition-all ${
              selectedRelease === 'books'
                ? 'bg-[#1e4636] text-[#faf7f1] ring-1 ring-[#1e4636]'
                : selectedRelease
                  ? 'bg-[#e7e0d2]/70 text-[#6e6558] opacity-65 hover:opacity-100'
                  : 'bg-[#8d6b32]/12 text-[#725524] hover:bg-[#8d6b32]/22'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                selectedRelease === 'books' ? 'bg-[#faf7f1]' : 'bg-[#8d6b32]'
              }`}
            />
            Books: {formatNumber(booksDownloads)}
          </button>
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
            <div className="flex justify-between text-[11px] sm:text-xs mb-1 tabular-nums">
              <button
                type="button"
                onClick={() => onToggleLanguage?.('en')}
                className={`cursor-pointer rounded px-1 -mx-1 transition-colors ${
                  selectedLanguage === 'en'
                    ? 'bg-[#1e4636] text-[#faf7f1] font-semibold'
                    : selectedLanguage
                      ? 'text-[#8c8272] hover:text-[#1c1914]'
                      : 'text-[#4a4338] hover:text-[#1e4636] font-medium'
                }`}
              >
                EN ({formatNumber(enItem?.all_time_downloads ?? 0)})
              </button>
              <button
                type="button"
                onClick={() => onToggleLanguage?.('de')}
                className={`cursor-pointer rounded px-1 -mx-1 transition-colors ${
                  selectedLanguage === 'de'
                    ? 'bg-[#1e4636] text-[#faf7f1] font-semibold'
                    : selectedLanguage
                      ? 'text-[#8c8272] hover:text-[#1c1914]'
                      : 'text-[#4a4338] hover:text-[#1e4636] font-medium'
                }`}
              >
                DE ({formatNumber(deItem?.all_time_downloads ?? 0)})
              </button>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#e7e0d2] overflow-hidden flex">
              <button
                type="button"
                aria-label="Filter English"
                onClick={() => onToggleLanguage?.('en')}
                className="h-full cursor-pointer transition-opacity"
                style={{
                  width: `${enPct}%`,
                  backgroundColor: selectedLanguage === 'de' ? '#c9c1af' : '#1e4636',
                }}
              />
              <button
                type="button"
                aria-label="Filter German"
                onClick={() => onToggleLanguage?.('de')}
                className="h-full cursor-pointer transition-opacity"
                style={{
                  width: `${100 - enPct}%`,
                  backgroundColor: selectedLanguage === 'de' ? '#1e4636' : selectedLanguage === 'en' ? '#c9c1af' : '#8d6b32',
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[11px] sm:text-xs mb-1 tabular-nums">
              <button
                type="button"
                onClick={() => onToggleEdition?.('tablet')}
                className={`cursor-pointer rounded px-1 -mx-1 transition-colors ${
                  selectedEdition === 'tablet'
                    ? 'bg-[#1e4636] text-[#faf7f1] font-semibold'
                    : selectedEdition
                      ? 'text-[#8c8272] hover:text-[#1c1914]'
                      : 'text-[#4a4338] hover:text-[#1e4636] font-medium'
                }`}
              >
                Tab ({formatNumber(tabletItem?.all_time_downloads ?? 0)})
              </button>
              <button
                type="button"
                onClick={() => onToggleEdition?.('phone')}
                className={`cursor-pointer rounded px-1 -mx-1 transition-colors ${
                  selectedEdition === 'phone'
                    ? 'bg-[#1e4636] text-[#faf7f1] font-semibold'
                    : selectedEdition
                      ? 'text-[#8c8272] hover:text-[#1c1914]'
                      : 'text-[#4a4338] hover:text-[#1e4636] font-medium'
                }`}
              >
                Phn ({formatNumber(phoneItem?.all_time_downloads ?? 0)})
              </button>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#e7e0d2] overflow-hidden flex">
              <button
                type="button"
                aria-label="Filter Tablet"
                onClick={() => onToggleEdition?.('tablet')}
                className="h-full cursor-pointer transition-opacity"
                style={{
                  width: `${tabletPct}%`,
                  backgroundColor: selectedEdition === 'phone' ? '#c9c1af' : '#1e4636',
                }}
              />
              <button
                type="button"
                aria-label="Filter Phone"
                onClick={() => onToggleEdition?.('phone')}
                className="h-full cursor-pointer transition-opacity"
                style={{
                  width: `${100 - tabletPct}%`,
                  backgroundColor: selectedEdition === 'phone' ? '#1e4636' : selectedEdition === 'tablet' ? '#c9c1af' : '#2b6b74',
                }}
              />
            </div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-[#6e6558] hidden sm:block">
          Tracked delta: +{formatNumber(all_time.tracked_delta)} (base {formatNumber(all_time.baseline_downloads)})
        </div>
      </div>

      {/* 4. Hourly Collector Health */}
      <button
        type="button"
        onClick={onOpenPolls}
        className="text-left rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-3.5 sm:p-5 shadow-xs hover:border-[#1e4636]/50 transition-colors cursor-pointer"
      >
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
      </button>
    </div>
  );
}
