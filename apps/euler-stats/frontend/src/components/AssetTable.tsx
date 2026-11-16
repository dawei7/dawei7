import type { AssetRow } from '../lib/types';
import { editionLabel, formatBytes, formatNumber, languageBadge } from '../lib/format';

export type SortField =
  | 'all_time_downloads'
  | 'window_delta'
  | 'last_24h_delta'
  | 'last_7d_delta'
  | 'size_bytes'
  | 'display_title';

interface AssetTableProps {
  assets: AssetRow[];
  sort: SortField;
  dir: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  onSelectAsset: (asset: AssetRow) => void;
  csvUrl: string;
}

export function AssetTable({
  assets,
  sort,
  dir,
  onSort,
  onSelectAsset,
  csvUrl,
}: AssetTableProps) {
  const maxDownloads = Math.max(1, ...assets.map((a) => a.all_time_downloads));

  const headerBtn = (field: SortField, label: string, alignRight = false) => {
    const active = sort === field;
    return (
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 cursor-pointer hover:text-[#1c1914] ${
          alignRight ? 'justify-end w-full' : ''
        } ${active ? 'text-[#1e4636] font-semibold' : ''}`}
      >
        <span>{label}</span>
        <span className="text-[10px]">
          {active ? (dir === 'desc' ? '▼' : '▲') : '↕'}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 shadow-xs overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#e7e0d2]">
        <div>
          <h2 className="text-lg font-medium text-[#1c1914]">
            Release Assets Leaderboard ({assets.length})
          </h2>
          <p className="text-xs text-[#6e6558]">
            Click any book or workbook to inspect its per-hour and per-day download history.
          </p>
        </div>

        <a
          href={csvUrl}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#d5cdb8] bg-[#f3eee4] px-3.5 py-1.5 text-xs font-medium text-[#1c1914] hover:border-[#8d6b32] transition-colors"
        >
          Download Assets CSV
        </a>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#e7e0d2] bg-[#f7f3ea]/80 text-[11px] uppercase tracking-wider text-[#6e6558]">
              <th className="py-3 pl-5 pr-3">{headerBtn('display_title', 'Item / Asset')}</th>
              <th className="py-3 px-3">Release</th>
              <th className="py-3 px-3">Subject</th>
              <th className="py-3 px-3">Lang · Device</th>
              <th className="py-3 px-3 text-right">{headerBtn('size_bytes', 'Size', true)}</th>
              <th className="py-3 px-3 text-right">{headerBtn('last_24h_delta', '24h Δ', true)}</th>
              <th className="py-3 px-3 text-right">{headerBtn('last_7d_delta', '7d Δ', true)}</th>
              <th className="py-3 px-3 text-right">{headerBtn('window_delta', 'Window Δ', true)}</th>
              <th className="py-3 pl-3 pr-5 text-right">{headerBtn('all_time_downloads', 'All-Time', true)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ece5d7]">
            {assets.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-[#6e6558]">
                  No assets match the current filters.
                </td>
              </tr>
            ) : (
              assets.map((a) => {
                const barW = Math.max(2, Math.round((a.all_time_downloads / maxDownloads) * 100));
                return (
                  <tr
                    key={a.asset_id}
                    onClick={() => onSelectAsset(a)}
                    className="hover:bg-[#f3eee4]/75 cursor-pointer transition-colors"
                  >
                    <td className="py-3 pl-5 pr-3 max-w-md">
                      <div className="font-medium text-[#1c1914] flex items-center gap-2">
                        <span className="truncate">{a.display_title}</span>
                        {a.included_in_app && (
                          <span className="shrink-0 rounded-full bg-[#e7e0d2] px-2 py-0.5 text-[10px] text-[#4a4338]">
                            Bundled
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6e6558] truncate mt-0.5 font-mono">
                        {a.asset_name}
                        {a.author ? ` · ${a.author}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          a.release_tag === 'curriculum'
                            ? 'bg-[#1e4636]/12 text-[#1e4636]'
                            : 'bg-[#8d6b32]/15 text-[#725524]'
                        }`}
                      >
                        {a.release_tag}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-xs text-[#4a4338] whitespace-nowrap">
                      {a.subject}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-xs">
                      <span className="inline-flex rounded bg-[#e7e0d2] px-1.5 py-0.5 font-medium text-[#1c1914] mr-1.5">
                        {languageBadge(a.language)}
                      </span>
                      <span className="text-[#4a4338]">{editionLabel(a.edition)}</span>
                    </td>
                    <td className="py-3 px-3 text-right text-xs text-[#6e6558] tabular-nums whitespace-nowrap">
                      {formatBytes(a.size_bytes)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-xs">
                      {a.last_24h_delta > 0 ? (
                        <span className="font-medium text-[#1e4636]">+{formatNumber(a.last_24h_delta)}</span>
                      ) : (
                        <span className="text-[#9e9484]">0</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-xs">
                      {a.last_7d_delta > 0 ? (
                        <span className="font-medium text-[#1e4636]">+{formatNumber(a.last_7d_delta)}</span>
                      ) : (
                        <span className="text-[#9e9484]">0</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-xs">
                      {a.window_delta > 0 ? (
                        <span className="font-semibold text-[#1e4636]">+{formatNumber(a.window_delta)}</span>
                      ) : (
                        <span className="text-[#9e9484]">0</span>
                      )}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right tabular-nums">
                      <div className="font-semibold text-[#1c1914]">
                        {formatNumber(a.all_time_downloads)}
                      </div>
                      <div className="mt-1 h-1 w-20 ml-auto rounded-full bg-[#e7e0d2] overflow-hidden">
                        <div className="h-full bg-[#1e4636]" style={{ width: `${barW}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
