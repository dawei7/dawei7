import { useEffect, useMemo, useRef, useState } from 'react';
import type { MetricMode, TimeSeriesBucket, TimeSeriesResponse } from '../lib/types';
import { formatNumber, formatTimestamp, seriesColor, seriesLabel } from '../lib/format';

interface TimeSeriesChartProps {
  data: TimeSeriesResponse;
  metric: MetricMode;
  onChangeMetric: (m: MetricMode) => void;
  firstPolledAt: string | null;
  baselineTotal: number;
  tz: string;
}

export function TimeSeriesChart({
  data,
  metric,
  onChangeMetric,
  firstPolledAt,
  baselineTotal,
  tz,
}: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(860);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 100) {
          setWidth(Math.floor(entry.contentRect.width));
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buckets = data.buckets;
  const keys = data.series_keys.length > 0 ? data.series_keys : ['total'];

  const height = 310;
  const margin = { top: 18, right: 20, bottom: 38, left: 50 };
  const plotW = Math.max(200, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;

  const { maxVal, hasAnyDelta, cumPoints } = useMemo(() => {
    let m = 0;
    let deltaPositive = false;
    const cPts: { idx: number; val: number }[] = [];
    buckets.forEach((b, idx) => {
      if (b.delta > 0) deltaPositive = true;
      if (metric === 'delta') {
        if (b.delta > m) m = b.delta;
      } else if (b.cumulative !== null) {
        if (b.cumulative > m) m = b.cumulative;
        cPts.push({ idx, val: b.cumulative });
      }
    });
    if (m === 0) m = 5;
    return { maxVal: niceMax(m), hasAnyDelta: deltaPositive, cumPoints: cPts };
  }, [buckets, metric]);

  const yTicks = useMemo(() => {
    const steps = 4;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      out.push(Math.round((maxVal * i) / steps));
    }
    return out;
  }, [maxVal]);

  const xLabelEvery = useMemo(() => {
    if (buckets.length <= 8) return 1;
    const maxLabels = Math.max(4, Math.floor(plotW / 86));
    return Math.ceil(buckets.length / maxLabels);
  }, [buckets.length, plotW]);

  const barStep = buckets.length > 0 ? plotW / buckets.length : plotW;
  const barW = Math.max(2, Math.min(34, barStep * 0.72));

  const yScale = (val: number) => plotH - (val / maxVal) * plotH;
  const xCenter = (idx: number) => margin.left + (idx + 0.5) * barStep;

  const cumLinePath = useMemo(() => {
    if (cumPoints.length === 0) return '';
    return cumPoints
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xCenter(pt.idx).toFixed(1)} ${(margin.top + yScale(pt.val)).toFixed(1)}`)
      .join(' ');
  }, [cumPoints, barStep, maxVal]);

  const cumAreaPath = useMemo(() => {
    if (cumPoints.length < 2) return '';
    const first = cumPoints[0];
    const last = cumPoints[cumPoints.length - 1];
    const baseY = (margin.top + plotH).toFixed(1);
    return `${cumLinePath} L ${xCenter(last.idx).toFixed(1)} ${baseY} L ${xCenter(first.idx).toFixed(1)} ${baseY} Z`;
  }, [cumLinePath, cumPoints, plotH]);

  const hoveredBucket: TimeSeriesBucket | null =
    hoverIdx !== null && buckets[hoverIdx] ? buckets[hoverIdx] : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (buckets.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left - margin.left;
    if (relX < 0 || relX > plotW) {
      setHoverIdx(null);
      return;
    }
    const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor(relX / barStep)));
    setHoverIdx(idx);
  };

  return (
    <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-medium text-[#1c1914]">
            {metric === 'delta' ? 'Downloads Over Time (New per Bucket)' : 'Cumulative Total Downloads'}
          </h2>
          <p className="text-xs text-[#6e6558] mt-0.5">
            Granularity: <strong className="text-[#4a4338]">{data.granularity}</strong> · Timezone:{' '}
            <strong className="text-[#4a4338]">{data.timezone}</strong> ·{' '}
            {buckets.length} continuous buckets
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#4a4338]">
            {keys.map((k, idx) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-xs"
                  style={{ backgroundColor: seriesColor(k, idx) }}
                />
                {seriesLabel(k)}
              </span>
            ))}
          </div>

          <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onChangeMetric('delta')}
              className={`rounded-full px-3 py-1 transition-colors cursor-pointer ${
                metric === 'delta'
                  ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                  : 'text-[#4a4338] hover:text-[#1c1914]'
              }`}
            >
              New (Delta)
            </button>
            <button
              type="button"
              onClick={() => onChangeMetric('cumulative')}
              className={`rounded-full px-3 py-1 transition-colors cursor-pointer ${
                metric === 'cumulative'
                  ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                  : 'text-[#4a4338] hover:text-[#1c1914]'
              }`}
            >
              Cumulative
            </button>
          </div>
        </div>
      </div>

      {/* Baseline initialization banner */}
      {firstPolledAt && metric === 'delta' && !hasAnyDelta && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#8d6b32]/30 bg-[#8d6b32]/10 px-3.5 py-2.5 text-xs text-[#4a4338]">
          <span>
            Tracking started <strong>{formatTimestamp(firstPolledAt, tz)}</strong> with{' '}
            <strong className="tabular-nums">{formatNumber(baselineTotal)}</strong> pre-existing
            downloads recorded as the baseline. Hourly &amp; daily deltas accumulate automatically on
            every top-of-hour poll.
          </span>
          <button
            type="button"
            onClick={() => onChangeMetric('cumulative')}
            className="rounded-full bg-[#8d6b32] px-3 py-1 text-[#fffcf6] font-medium hover:bg-[#725524] transition-colors cursor-pointer"
          >
            View Cumulative Baseline
          </button>
        </div>
      )}

      <div ref={containerRef} className="relative w-full select-none">
        <svg
          width={width}
          height={height}
          className="overflow-visible block"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Horizontal gridlines + Y-axis labels */}
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

          {/* Hover vertical highlight */}
          {hoverIdx !== null && buckets[hoverIdx] && (
            <rect
              x={margin.left + hoverIdx * barStep}
              y={margin.top}
              width={barStep}
              height={plotH}
              fill="#1e4636"
              fillOpacity={0.07}
              rx={3}
            />
          )}

          {/* Stacked Bars (Delta mode) */}
          {metric === 'delta' &&
            buckets.map((b, idx) => {
              let runningY = plotH;
              const x = xCenter(idx) - barW / 2;
              return (
                <g key={b.timestamp}>
                  {keys.map((k, kIdx) => {
                    const val = b.series[k] ?? 0;
                    if (val <= 0) return null;
                    const segH = Math.max(1.5, (val / maxVal) * plotH);
                    runningY -= segH;
                    return (
                      <rect
                        key={k}
                        x={x}
                        y={margin.top + runningY}
                        width={barW}
                        height={segH}
                        fill={seriesColor(k, kIdx)}
                        fillOpacity={hoverIdx === idx ? 1 : 0.88}
                        rx={1.5}
                      />
                    );
                  })}
                </g>
              );
            })}

          {/* Cumulative Area + Line (Cumulative mode) */}
          {metric === 'cumulative' && (
            <g>
              {cumAreaPath && <path d={cumAreaPath} fill="#1e4636" fillOpacity={0.12} />}
              {cumLinePath && (
                <path
                  d={cumLinePath}
                  fill="none"
                  stroke="#1e4636"
                  strokeWidth={2.25}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {cumPoints.map((pt) => (
                <circle
                  key={pt.idx}
                  cx={xCenter(pt.idx)}
                  cy={margin.top + yScale(pt.val)}
                  r={hoverIdx === pt.idx ? 5 : cumPoints.length <= 20 ? 3.5 : 2}
                  fill="#fffcf6"
                  stroke="#1e4636"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}

          {/* X-axis tick labels */}
          {buckets.map((b, idx) => {
            const isLast = idx === buckets.length - 1;
            if (idx % xLabelEvery !== 0 && !isLast) return null;
            if (isLast && idx > 0 && idx % xLabelEvery < xLabelEvery * 0.4) return null;
            return (
              <text
                key={b.timestamp}
                x={xCenter(idx)}
                y={height - 10}
                textAnchor="middle"
                className="fill-[#6e6558] text-[11px] tabular-nums"
              >
                {b.label}
              </text>
            );
          })}
        </svg>

        {/* Floating Hover Tooltip */}
        {hoveredBucket && hoverIdx !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-48 rounded-xl border border-[#d5cdb8] bg-[#fffcf6]/95 p-3 shadow-md text-xs"
            style={{
              left:
                xCenter(hoverIdx) > width * 0.65
                  ? Math.max(8, xCenter(hoverIdx) - 210)
                  : Math.min(width - 210, xCenter(hoverIdx) + 12),
            }}
          >
            <div className="font-semibold text-[#1c1914] mb-1.5">
              {formatTimestamp(hoveredBucket.timestamp, tz)}
            </div>
            <div className="space-y-1 tabular-nums">
              <div className="flex justify-between gap-4 text-[#4a4338]">
                <span>New downloads:</span>
                <strong className="text-[#1c1914]">+{formatNumber(hoveredBucket.delta)}</strong>
              </div>
              <div className="flex justify-between gap-4 text-[#4a4338]">
                <span>Cumulative total:</span>
                <strong className="text-[#1c1914]">
                  {hoveredBucket.cumulative !== null
                    ? formatNumber(hoveredBucket.cumulative)
                    : 'No snapshot'}
                </strong>
              </div>
              {keys.length > 1 && (
                <div className="mt-1.5 pt-1.5 border-t border-[#e7e0d2] space-y-0.5">
                  {keys.map((k, kIdx) => {
                    const val =
                      metric === 'delta'
                        ? hoveredBucket.series[k] ?? 0
                        : hoveredBucket.cum_series?.[k] ?? 0;
                    return (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-[#4a4338]">
                          <span
                            className="h-2 w-2 rounded-xs"
                            style={{ backgroundColor: seriesColor(k, kIdx) }}
                          />
                          {seriesLabel(k)}
                        </span>
                        <span className="font-medium text-[#1c1914]">
                          {metric === 'delta' ? `+${formatNumber(val)}` : formatNumber(val)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / pow;
  let nice = 10;
  if (frac <= 1.2) nice = 1.2;
  else if (frac <= 2) nice = 2;
  else if (frac <= 4) nice = 4;
  else if (frac <= 5) nice = 5;
  else if (frac <= 8) nice = 8;
  return Math.ceil(nice * pow);
}
