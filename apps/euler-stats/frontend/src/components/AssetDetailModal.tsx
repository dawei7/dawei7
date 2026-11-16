import { useEffect, useState } from 'react';
import { fetchItemVersions, fetchTimeSeries } from '../lib/api';
import type {
  AssetMode,
  AssetRow,
  FilterState,
  Granularity,
  MetricMode,
  TimeSeriesResponse,
} from '../lib/types';
import {
  editionLabel,
  formatBytes,
  formatNumber,
  formatTimestamp,
  languageBadge,
} from '../lib/format';
import { TimeSeriesChart } from './TimeSeriesChart';

interface AssetDetailModalProps {
  asset: AssetRow;
  mode: AssetMode;
  filters: FilterState;
  firstPolledAt: string | null;
  onClose: () => void;
}

export function AssetDetailModal({
  asset,
  mode,
  filters,
  firstPolledAt,
  onClose,
}: AssetDetailModalProps) {
  const [gran, setGran] = useState<Granularity>(filters.granularity);
  const [metric, setMetric] = useState<MetricMode>('delta');
  const [ts, setTs] = useState<TimeSeriesResponse | null>(null);
  const [versions, setVersions] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');

    const tsFilterExtra =
      mode === 'items'
        ? { release: asset.release_tag, item_key: asset.item_key }
        : { asset_id: asset.asset_id };

    Promise.all([
      fetchTimeSeries(
        { ...filters, granularity: gran, groupBy: 'none' },
        tsFilterExtra,
        ac.signal,
      ),
      fetchItemVersions(asset.release_tag, asset.item_key, ac.signal),
    ])
      .then(([seriesRes, verRes]) => {
        setTs(seriesRes);
        setVersions(verRes);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [asset.asset_id, asset.item_key, asset.release_tag, mode, filters, gran]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1c1914]/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#d5cdb8] bg-[#f7f3ea] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d5cdb8] pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
              <span className="rounded-full bg-[#1e4636]/12 px-2.5 py-0.5 font-medium text-[#1e4636]">
                {asset.release_tag}
              </span>
              <span className="rounded-full bg-[#e7e0d2] px-2.5 py-0.5 text-[#4a4338]">
                {asset.subject}
              </span>
              <span className="rounded-full bg-[#e7e0d2] px-2.5 py-0.5 text-[#4a4338]">
                {languageBadge(asset.language)} · {editionLabel(asset.edition)}
              </span>
              {mode === 'items' && versions.length > 1 && (
                <span className="rounded-full bg-[#8d6b32]/15 px-2.5 py-0.5 font-medium text-[#725524]">
                  Accumulated across {versions.length} versions
                </span>
              )}
            </div>
            <h2 className="text-2xl font-medium text-[#1c1914]">{asset.display_title}</h2>
            <p className="text-xs font-mono text-[#6e6558] mt-1">
              {mode === 'items' ? `item: ${asset.item_key} (latest: ${asset.asset_name})` : asset.asset_name}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#d5cdb8] bg-[#fffcf6] px-3 py-1.5 text-xs font-medium text-[#4a4338] hover:text-[#1c1914] cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Metadata strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4 text-xs">
          <div className="rounded-xl border border-[#d5cdb8] bg-[#fffcf6] p-3">
            <span className="text-[#6e6558] block">
              {mode === 'items' ? 'Accumulated Downloads' : 'Version Downloads'}
            </span>
            <strong className="text-lg text-[#1c1914] tabular-nums">
              {formatNumber(asset.all_time_downloads)}
            </strong>
            {mode === 'items' && asset.version_count > 1 && (
              <span className="block text-[11px] text-[#6e6558] tabular-nums">
                Current file: {formatNumber(asset.current_version_downloads)}
              </span>
            )}
          </div>
          <div className="rounded-xl border border-[#d5cdb8] bg-[#fffcf6] p-3">
            <span className="text-[#6e6558] block">Window / 24h Δ</span>
            <strong className="text-lg text-[#1e4636] tabular-nums">
              +{formatNumber(asset.window_delta)} / +{formatNumber(asset.last_24h_delta)}
            </strong>
          </div>
          <div className="rounded-xl border border-[#d5cdb8] bg-[#fffcf6] p-3">
            <span className="text-[#6e6558] block">Current File Size</span>
            <strong className="text-lg text-[#1c1914] tabular-nums">
              {formatBytes(asset.size_bytes)}
            </strong>
          </div>
          <div className="rounded-xl border border-[#d5cdb8] bg-[#fffcf6] p-3">
            <span className="text-[#6e6558] block">Updated on GitHub</span>
            <strong className="text-sm text-[#1c1914] tabular-nums">
              {formatTimestamp(asset.asset_updated_at, filters.tz)}
            </strong>
          </div>
        </div>

        {/* Granularity switcher for this item */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#fffcf6] p-0.5 text-xs">
            {(['hour', '6h', 'day', 'week', 'month'] as Granularity[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGran(g)}
                className={`rounded-full px-3 py-1 cursor-pointer transition-colors ${
                  gran === g
                    ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                    : 'text-[#4a4338] hover:text-[#1c1914]'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {asset.download_url && (
            <a
              href={asset.download_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#1e4636] underline hover:text-[#143028]"
            >
              GitHub Asset Link ↗
            </a>
          )}
        </div>

        {loading && !ts ? (
          <div className="py-12 text-center text-sm text-[#6e6558]">Loading history...</div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-[#a4513a]">{error}</div>
        ) : ts ? (
          <TimeSeriesChart
            data={ts}
            metric={metric}
            onChangeMetric={setMetric}
            firstPolledAt={firstPolledAt}
            baselineTotal={asset.all_time_downloads}
            tz={filters.tz}
          />
        ) : null}

        {/* Version History Table */}
        {versions.length > 0 && (
          <div className="mt-4 rounded-xl border border-[#d5cdb8] bg-[#fffcf6] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#e7e0d2] flex items-center justify-between text-xs">
              <strong className="text-[#1c1914]">
                File Version History ({versions.length})
              </strong>
              <span className="text-[#6e6558] tabular-nums">
                Total across all versions: {formatNumber(versions.reduce((s, v) => s + v.all_time_downloads, 0))}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#e7e0d2] bg-[#f7f3ea] text-[10px] uppercase tracking-wider text-[#6e6558]">
                    <th className="py-2 pl-4 pr-2">File Hash / Name</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 px-2 text-right">Size</th>
                    <th className="py-2 px-2">First Seen</th>
                    <th className="py-2 px-2">Last Seen</th>
                    <th className="py-2 pl-2 pr-4 text-right">Downloads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ece5d7] tabular-nums">
                  {versions.map((v) => (
                    <tr key={v.asset_id}>
                      <td className="py-2 pl-4 pr-2 font-mono text-[#1c1914]">{v.asset_name}</td>
                      <td className="py-2 px-2">
                        {v.is_active ? (
                          <span className="rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[10px] font-medium text-[#1e4636]">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#8d6b32]/15 px-2 py-0.5 text-[10px] font-medium text-[#725524]">
                            Deleted / Replaced
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right text-[#6e6558]">{formatBytes(v.size_bytes)}</td>
                      <td className="py-2 px-2 text-[#4a4338]">{formatTimestamp(v.first_seen_at, filters.tz)}</td>
                      <td className="py-2 px-2 text-[#4a4338]">{formatTimestamp(v.last_seen_at, filters.tz)}</td>
                      <td className="py-2 pl-2 pr-4 text-right font-semibold text-[#1c1914]">
                        {formatNumber(v.all_time_downloads)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(asset.author || asset.license || asset.pages > 0) && (
          <div className="mt-4 rounded-xl border border-[#d5cdb8] bg-[#fffcf6] p-3.5 text-xs text-[#4a4338] flex flex-wrap gap-x-6 gap-y-1">
            {asset.author && (
              <span>
                <strong>Author:</strong> {asset.author}
              </span>
            )}
            {asset.license && (
              <span>
                <strong>License:</strong> {asset.license}
              </span>
            )}
            {asset.pages > 0 && (
              <span>
                <strong>Pages:</strong> {formatNumber(asset.pages)}
              </span>
            )}
            {asset.exercises > 0 && (
              <span>
                <strong>Exercises:</strong> {formatNumber(asset.exercises)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
