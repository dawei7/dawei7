import { useEffect, useState } from 'react';
import { fetchTimeSeries } from '../lib/api';
import type { AssetRow, FilterState, Granularity, MetricMode, TimeSeriesResponse } from '../lib/types';
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
  filters: FilterState;
  firstPolledAt: string | null;
  onClose: () => void;
}

export function AssetDetailModal({
  asset,
  filters,
  firstPolledAt,
  onClose,
}: AssetDetailModalProps) {
  const [gran, setGran] = useState<Granularity>(filters.granularity);
  const [metric, setMetric] = useState<MetricMode>('delta');
  const [ts, setTs] = useState<TimeSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');
    fetchTimeSeries(
      { ...filters, granularity: gran, groupBy: 'none' },
      { asset_id: asset.asset_id },
      ac.signal,
    )
      .then((res) => setTs(res))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [asset.asset_id, filters, gran, firstPolledAt]);

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
              <span className="rounded-full bg-[#e7e0d2] px-2 py-0.5 text-[#4a4338]">
                {languageBadge(asset.language)} · {editionLabel(asset.edition)}
              </span>
            </div>
            <h2 className="text-2xl font-medium text-[#1c1914]">{asset.display_title}</h2>
            <p className="text-xs font-mono text-[#6e6558] mt-1">{asset.asset_name}</p>
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
            <span className="text-[#6e6558] block">All-Time Downloads</span>
            <strong className="text-lg text-[#1c1914] tabular-nums">
              {formatNumber(asset.all_time_downloads)}
            </strong>
          </div>
          <div className="rounded-xl border border-[#d5cdb8] bg-[#fffcf6] p-3">
            <span className="text-[#6e6558] block">Window / 24h Δ</span>
            <strong className="text-lg text-[#1e4636] tabular-nums">
              +{formatNumber(asset.window_delta)} / +{formatNumber(asset.last_24h_delta)}
            </strong>
          </div>
          <div className="rounded-xl border border-[#d5cdb8] bg-[#fffcf6] p-3">
            <span className="text-[#6e6558] block">File Size</span>
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

        {/* Granularity switcher for this asset */}
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
          <div className="py-12 text-center text-sm text-[#6e6558]">Loading asset history...</div>
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
