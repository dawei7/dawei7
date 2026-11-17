import { useState } from 'react';
import type { ActivityCell, HourProfilePoint } from '../lib/types';
import { formatNumber } from '../lib/format';

interface ActivityHeatmapProps {
  hourlyProfile: HourProfilePoint[];
  matrix: ActivityCell[];
  tz: string;
  selectedHour?: number | null;
  selectedDow?: number | null;
  onSelectHour?: (hour: number | null) => void;
  onSelectDow?: (dow: number | null) => void;
  onSelectCell?: (dow: number, hour: number) => void;
}

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function ActivityHeatmap({
  hourlyProfile,
  matrix,
  tz,
  selectedHour = null,
  selectedDow = null,
  onSelectHour,
  onSelectDow,
  onSelectCell,
}: ActivityHeatmapProps) {
  const [view, setView] = useState<'profile' | 'matrix'>('profile');

  const maxHourTotal = Math.max(1, ...hourlyProfile.map((h) => h.total_delta));
  const maxCellTotal = Math.max(1, ...matrix.map((c) => c.total_delta));

  const cellLookup = new Map<string, ActivityCell>();
  for (const c of matrix) {
    cellLookup.set(`${c.day_of_week}-${c.hour}`, c);
  }

  const hasHourFilter = selectedHour !== null;
  const hasAnySliceFilter = selectedHour !== null || selectedDow !== null;

  return (
    <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-base font-medium text-[#1c1914]">Hourly Activity Pattern</h3>
          <p className="text-xs text-[#6e6558]">
            {onSelectHour ? 'Tap any bar or cell to filter' : 'When downloads occur by hour of day'} ({tz})
          </p>
        </div>

        <div className="inline-flex rounded-full border border-[#d5cdb8] bg-[#f3eee4] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView('profile')}
            className={`rounded-full px-2.5 py-1 cursor-pointer transition-colors ${
              view === 'profile'
                ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                : 'text-[#4a4338] hover:text-[#1c1914]'
            }`}
          >
            24h Profile
          </button>
          <button
            type="button"
            onClick={() => setView('matrix')}
            className={`rounded-full px-2.5 py-1 cursor-pointer transition-colors ${
              view === 'matrix'
                ? 'bg-[#1e4636] text-[#faf7f1] font-medium'
                : 'text-[#4a4338] hover:text-[#1c1914]'
            }`}
          >
            Week Grid
          </button>
        </div>
      </div>

      {view === 'profile' ? (
        <div className="flex-1 flex flex-col justify-end">
          <div className="grid grid-cols-24 gap-1 items-end h-36 pt-4">
            {hourlyProfile.map((pt) => {
              const pct = pt.total_delta > 0 ? Math.max(8, Math.round((pt.total_delta / maxHourTotal) * 100)) : 5;
              const isSelected = selectedHour === pt.hour;
              const isDimmed = hasHourFilter && !isSelected;
              return (
                <button
                  key={pt.hour}
                  type="button"
                  onClick={() => onSelectHour?.(isSelected ? null : pt.hour)}
                  className={`group relative flex flex-col items-center justify-end h-full cursor-pointer transition-opacity ${
                    isDimmed ? 'opacity-30 hover:opacity-75' : 'opacity-100'
                  }`}
                  title={`${String(pt.hour).padStart(2, '0')}:00 — ${formatNumber(pt.total_delta)} downloads (avg ${pt.avg_delta.toFixed(2)}/poll) · Click to filter`}
                >
                  <div
                    className={`w-full rounded-t-xs transition-all ${
                      isSelected
                        ? 'bg-[#1e4636] ring-2 ring-[#1e4636] ring-offset-1 ring-offset-[#fffcf6]'
                        : pt.total_delta > 0
                          ? 'bg-[#1e4636] group-hover:bg-[#8d6b32]'
                          : 'bg-[#e3dccb] group-hover:bg-[#c8bea6]'
                    }`}
                    style={{ height: `${pct}%` }}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-6 text-[10px] text-[#6e6558] tabular-nums">
            <span>00:00</span>
            <span>04:00</span>
            <span>08:00</span>
            <span>12:00</span>
            <span>16:00</span>
            <span className="text-right">23:00</span>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[440px] space-y-1">
            {dayNames.map((name, dIdx) => {
              const dow = dIdx + 1;
              const isDowSelected = selectedDow === dow && selectedHour === null;
              return (
                <div key={name} className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-1 items-center">
                  <button
                    type="button"
                    onClick={() => onSelectDow?.(selectedDow === dow && selectedHour === null ? null : dow)}
                    className={`text-left text-[10px] font-medium cursor-pointer rounded px-0.5 py-0.5 transition-colors ${
                      isDowSelected
                        ? 'bg-[#1e4636] text-[#faf7f1]'
                        : selectedDow === dow
                          ? 'text-[#1e4636] font-semibold'
                          : 'text-[#6e6558] hover:text-[#1c1914]'
                    }`}
                    title={`Filter to ${name}`}
                  >
                    {name}
                  </button>
                  {Array.from({ length: 24 }, (_, hr) => {
                    const cell = cellLookup.get(`${dow}-${hr}`);
                    const val = cell?.total_delta ?? 0;
                    const intensity = val > 0 ? 0.25 + 0.75 * (val / maxCellTotal) : 0;
                    const cellMatches =
                      (selectedDow === null || selectedDow === dow) &&
                      (selectedHour === null || selectedHour === hr);
                    const isExact = selectedDow === dow && selectedHour === hr;
                    return (
                      <button
                        key={hr}
                        type="button"
                        onClick={() => onSelectCell?.(dow, hr)}
                        className={`h-4 rounded-[3px] border cursor-pointer transition-all ${
                          isExact
                            ? 'border-[#1e4636] ring-2 ring-[#1e4636] ring-offset-1 ring-offset-[#fffcf6] z-10'
                            : hasAnySliceFilter && cellMatches
                              ? 'border-[#1e4636]/70'
                              : 'border-[#e7e0d2]'
                        } ${hasAnySliceFilter && !cellMatches ? 'opacity-25 hover:opacity-75' : ''}`}
                        style={{
                          backgroundColor:
                            val > 0
                              ? `rgba(30, 70, 54, ${intensity.toFixed(2)})`
                              : isExact
                                ? 'rgba(30, 70, 54, 0.22)'
                                : '#f3eee4',
                        }}
                        title={`${name} ${String(hr).padStart(2, '0')}:00 — ${formatNumber(val)} downloads (${cell?.sample_count ?? 0} polls) · Click to filter`}
                      />
                    );
                  })}
                </div>
              );
            })}
            <div className="grid grid-cols-[2rem_1fr] pt-1 text-[10px] text-[#6e6558] tabular-nums">
              <span />
              <div className="flex justify-between">
                <span>00h</span>
                <span>06h</span>
                <span>12h</span>
                <span>18h</span>
                <span>23h</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
