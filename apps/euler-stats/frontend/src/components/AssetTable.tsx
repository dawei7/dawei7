import type { AssetMode, AssetRow } from '../lib/types';
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
  mode: AssetMode;
  onChangeMode: (m: AssetMode) => void;
  sort: SortField;
  dir: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  onSelectAsset: (asset: AssetRow) => void;
  csvUrl: string;
  sliceActive?: boolean;
  totalMatchingCount?: number;
  showAllInSlice?: boolean;
  onToggleShowAllInSlice?: () => void;
  selectedItemKey?: string;
  selectedRelease?: string;
  selectedSubject?: string;
  selectedLanguage?: string;
  selectedEdition?: string;
  onToggleItemFilter?: (asset: AssetRow) => void;
  onToggleFacet?: (facet: 'release' | 'subject' | 'language' | 'edition', value: string) => void;
}

export function AssetTable({
  assets,
  mode,
  onChangeMode,
  sort,
  dir,
  onSort,
  onSelectAsset,
  csvUrl,
  sliceActive = false,
  totalMatchingCount,
  showAllInSlice = false,
  onToggleShowAllInSlice,
  selectedItemKey = '',
  selectedRelease = '',
  selectedSubject = '',
  selectedLanguage = '',
  selectedEdition = '',
  onToggleItemFilter,
  onToggleFacet,
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
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-[#e7e0d2]">
        <div>
          <h2 className="text-base sm:text-lg font-medium text-[#1c1914]">
            {mode === 'items'
              ? `Workbooks & Books (${assets.length})`
              : `Individual File Versions (${assets.length})`}
          </h2>
          <p className="text-xs text-[#6e6558]">
            {mode === 'items'
              ? 'Accumulated across replaced/deleted versions. Tap any item for version history.'
              : 'Each uploaded file hash listed separately.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sliceActive && onToggleShowAllInSlice && (
            <button
              type="button"
              onClick={onToggleShowAllInSlice}
              className={`rounded-full border px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                showAllInSlice
                  ? 'border-[#d5cdb8] bg-[#f3eee4] text-[#4a4338] hover:border-[#1e4636]'
                  : 'border-[#1e4636] bg-[#1e4636]/12 text-[#1e4636]'
              }`}
            >
              {showAllInSlice
                ? 'Active in slice only'
                : `Active in slice (${assets.length}${totalMatchingCount !== undefined ? ` / ${totalMatchingCount}` : ''})`}
            </button>
          )}
          <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onChangeMode('items')}
              className={`rounded-full px-3 py-1 cursor-pointer transition-colors ${
                mode === 'items'
                  ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                  : 'text-[#4a4338] hover:text-[#1c1914]'
              }`}
            >
              Accumulated
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('files')}
              className={`rounded-full px-3 py-1 cursor-pointer transition-colors ${
                mode === 'files'
                  ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                  : 'text-[#4a4338] hover:text-[#1c1914]'
              }`}
            >
              Files
            </button>
          </div>

          <a
            href={csvUrl}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#d5cdb8] bg-[#f3eee4] px-3 py-1.5 text-xs font-medium text-[#1c1914] hover:border-[#8d6b32] transition-colors"
          >
            CSV
          </a>
        </div>
      </div>

      {/* Mobile sort selector */}
      <div className="md:hidden flex items-center justify-between gap-2 px-4 py-2.5 bg-[#f7f3ea]/70 border-b border-[#e7e0d2] text-xs">
        <span className="text-[#6e6558]">Sort by</span>
        <div className="flex items-center gap-1.5">
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortField)}
            className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-sm text-[#1c1914]"
          >
            <option value="all_time_downloads">Accumulated Downloads</option>
            <option value="window_delta">Window New</option>
            <option value="last_24h_delta">Last 24h</option>
            <option value="last_7d_delta">Last 7d</option>
            <option value="size_bytes">File Size</option>
            <option value="display_title">Title</option>
          </select>
          <button
            type="button"
            onClick={() => onSort(sort)}
            className="rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1 text-xs text-[#1c1914]"
          >
            {dir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden divide-y divide-[#ece5d7]">
        {assets.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#6e6558]">
            No assets match the current filters.
          </div>
        ) : (
          assets.map((a) => {
            const barW = Math.max(2, Math.round((a.all_time_downloads / maxDownloads) * 100));
            const rowKey = mode === 'items' ? `${a.release_tag}:${a.item_key}` : String(a.asset_id);
            return (
              <button
                key={rowKey}
                type="button"
                onClick={() => onSelectAsset(a)}
                className="w-full text-left px-4 py-3.5 active:bg-[#f3eee4] transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-[#1c1914] leading-snug">
                      {a.display_title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFacet?.('release', a.release_tag);
                        }}
                        className={`rounded-full px-2 py-0.5 font-medium cursor-pointer transition-colors ${
                          selectedRelease === a.release_tag
                            ? 'bg-[#1e4636] text-[#faf7f1]'
                            : a.release_tag === 'curriculum'
                              ? 'bg-[#1e4636]/12 text-[#1e4636]'
                              : 'bg-[#8d6b32]/15 text-[#725524]'
                        }`}
                      >
                        {a.release_tag}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFacet?.('language', a.language);
                        }}
                        className={`rounded px-1.5 py-0.5 font-medium cursor-pointer transition-colors ${
                          selectedLanguage === a.language
                            ? 'bg-[#1e4636] text-[#faf7f1]'
                            : 'bg-[#e7e0d2] text-[#1c1914]'
                        }`}
                      >
                        {languageBadge(a.language)}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFacet?.('edition', a.edition);
                        }}
                        className={`rounded px-1.5 py-0.5 cursor-pointer transition-colors ${
                          selectedEdition === a.edition
                            ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                            : 'text-[#4a4338] hover:bg-[#e7e0d2]/70'
                        }`}
                      >
                        {editionLabel(a.edition)}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleItemFilter?.(a);
                        }}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                          selectedItemKey === a.item_key
                            ? 'border-[#1e4636] bg-[#1e4636] text-[#faf7f1]'
                            : 'border-[#d5cdb8] bg-[#fffcf6] text-[#4a4338] hover:border-[#1e4636]'
                        }`}
                      >
                        {selectedItemKey === a.item_key ? 'Filtered' : 'Filter'}
                      </button>
                      <span className="text-[#6e6558]">· {formatBytes(a.size_bytes)}</span>
                      {mode === 'items' && a.version_count > 1 && (
                        <span className="rounded-full bg-[#1e4636]/12 px-1.5 py-0.5 text-[10px] font-medium text-[#1e4636]">
                          {a.version_count} ver
                        </span>
                      )}
                      {!a.is_active && (
                        <span className="rounded-full bg-[#8d6b32]/15 px-1.5 py-0.5 text-[10px] text-[#725524]">
                          Retired
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <div className="text-base font-semibold text-[#1c1914]">
                      {formatNumber(a.all_time_downloads)}
                    </div>
                    {a.window_delta > 0 && (
                      <div className="text-[11px] font-medium text-[#1e4636]">
                        +{formatNumber(a.window_delta)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-[#e7e0d2] overflow-hidden">
                  <div className="h-full bg-[#1e4636]" style={{ width: `${barW}%` }} />
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
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
              <th className="py-3 pl-3 pr-5 text-right">{headerBtn('all_time_downloads', 'Accumulated', true)}</th>
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
                const rowKey = mode === 'items' ? `${a.release_tag}:${a.item_key}` : String(a.asset_id);
                return (
                  <tr
                    key={rowKey}
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
                        {mode === 'items' && a.version_count > 1 && (
                          <span className="shrink-0 rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[10px] font-medium text-[#1e4636] tabular-nums">
                            {a.version_count} versions
                          </span>
                        )}
                        {!a.is_active && (
                          <span className="shrink-0 rounded-full bg-[#8d6b32]/15 px-2 py-0.5 text-[10px] font-medium text-[#725524]">
                            Retired
                          </span>
                        )}
                        {onToggleItemFilter && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleItemFilter(a);
                            }}
                            title="Filter all charts & KPIs to this item"
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                              selectedItemKey === a.item_key
                                ? 'border-[#1e4636] bg-[#1e4636] text-[#faf7f1]'
                                : 'border-[#d5cdb8] bg-[#fffcf6] text-[#6e6558] hover:border-[#1e4636] hover:text-[#1e4636]'
                            }`}
                          >
                            {selectedItemKey === a.item_key ? 'Filtered' : 'Filter'}
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-[#6e6558] truncate mt-0.5 font-mono">
                        {mode === 'items' ? a.item_key : a.asset_name}
                        {a.author ? ` · ${a.author}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFacet?.('release', a.release_tag);
                        }}
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-colors ${
                          selectedRelease === a.release_tag
                            ? 'bg-[#1e4636] text-[#faf7f1]'
                            : a.release_tag === 'curriculum'
                              ? 'bg-[#1e4636]/12 text-[#1e4636] hover:bg-[#1e4636]/20'
                              : 'bg-[#8d6b32]/15 text-[#725524] hover:bg-[#8d6b32]/25'
                        }`}
                      >
                        {a.release_tag}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-xs whitespace-nowrap">
                      {a.subject ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFacet?.('subject', a.subject);
                          }}
                          className={`rounded px-1.5 py-0.5 cursor-pointer transition-colors ${
                            selectedSubject === a.subject
                              ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                              : 'text-[#4a4338] hover:bg-[#e7e0d2]/75'
                          }`}
                        >
                          {a.subject}
                        </button>
                      ) : (
                        <span className="text-[#9e9484]">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFacet?.('language', a.language);
                        }}
                        className={`inline-flex rounded px-1.5 py-0.5 font-medium mr-1.5 cursor-pointer transition-colors ${
                          selectedLanguage === a.language
                            ? 'bg-[#1e4636] text-[#faf7f1]'
                            : 'bg-[#e7e0d2] text-[#1c1914] hover:bg-[#d5cdb8]'
                        }`}
                      >
                        {languageBadge(a.language)}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFacet?.('edition', a.edition);
                        }}
                        className={`rounded px-1.5 py-0.5 cursor-pointer transition-colors ${
                          selectedEdition === a.edition
                            ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                            : 'text-[#4a4338] hover:bg-[#e7e0d2]/75'
                        }`}
                      >
                        {editionLabel(a.edition)}
                      </button>
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
                      {mode === 'items' && a.version_count > 1 && (
                        <div className="text-[10px] text-[#6e6558]">
                          current: {formatNumber(a.current_version_downloads)}
                        </div>
                      )}
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
