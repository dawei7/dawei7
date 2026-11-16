import { useState } from 'react';
import type { BreakdownItem, OverviewResponse } from '../lib/types';
import { editionLabel, formatBytes, formatNumber, languageBadge, seriesLabel } from '../lib/format';

interface BreakdownsGridProps {
  overview: OverviewResponse;
  onSelectFilter: (kind: 'release' | 'subject' | 'language' | 'edition', value: string) => void;
}

type DimTab = 'subject' | 'release' | 'language' | 'edition';

export function BreakdownsGrid({ overview, onSelectFilter }: BreakdownsGridProps) {
  const [tab, setTab] = useState<DimTab>('subject');

  const items: BreakdownItem[] =
    tab === 'subject'
      ? overview.by_subject
      : tab === 'release'
        ? overview.by_release
        : tab === 'language'
          ? overview.by_language
          : overview.by_edition;

  const maxTotal = Math.max(1, ...items.map((x) => x.all_time_downloads));

  const formatKey = (key: string) => {
    if (tab === 'release') return seriesLabel(key);
    if (tab === 'language') return `${languageBadge(key)} · ${seriesLabel(key)}`;
    if (tab === 'edition') return editionLabel(key);
    return key;
  };

  return (
    <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-base font-medium text-[#1c1914]">Catalog Breakdown</h3>
          <p className="text-xs text-[#6e6558]">Click a row to filter dashboard</p>
        </div>

        <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
          {(
            [
              ['subject', 'Subject'],
              ['release', 'Release'],
              ['language', 'Language'],
              ['edition', 'Edition'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-2.5 py-1 cursor-pointer transition-colors ${
                tab === id
                  ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                  : 'text-[#4a4338] hover:text-[#1c1914]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <div className="text-xs text-[#6e6558] py-8 text-center">No matching assets.</div>
        ) : (
          items.map((item) => {
            const pct = Math.max(2, Math.round((item.all_time_downloads / maxTotal) * 100));
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelectFilter(tab, item.key)}
                className="w-full text-left group cursor-pointer rounded-lg px-2 py-1.5 hover:bg-[#f3eee4]/80 transition-colors"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-[#1c1914] group-hover:text-[#1e4636] truncate pr-2">
                    {formatKey(item.key)}
                  </span>
                  <span className="tabular-nums text-[#4a4338] shrink-0">
                    <strong className="text-[#1c1914]">{formatNumber(item.all_time_downloads)}</strong>
                    {item.window_delta > 0 && (
                      <span className="text-[#1e4636] ml-1.5">(+{formatNumber(item.window_delta)})</span>
                    )}
                    <span className="text-[#6e6558] ml-1.5">
                      · {item.asset_count} files ({formatBytes(item.total_bytes)})
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#e7e0d2] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#1e4636] group-hover:bg-[#8d6b32] transition-colors"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
