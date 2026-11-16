import type { PollRunRow, PollerStatus } from '../lib/types';
import { formatNumber, formatTimestamp } from '../lib/format';

interface PollLogTabProps {
  polls: PollRunRow[];
  poller: PollerStatus | null;
  tz: string;
}

export function PollLogTab({ polls, poller, tz }: PollLogTabProps) {
  return (
    <div className="space-y-4">
      {poller && (
        <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4 text-sm">
          <div>
            <h2 className="text-lg font-medium text-[#1c1914]">Hourly Collector Schedule</h2>
            <p className="text-xs text-[#6e6558] mt-0.5">
              Polls <code className="text-[#1e4636]">api.github.com/repos/dawei7/professor-euler-library/releases</code>{' '}
              every hour at <strong className="text-[#4a4338]">:00:05 UTC</strong> (with paginated asset lookup).
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs tabular-nums">
            <div className="rounded-xl bg-[#f3eee4] px-3 py-2">
              <span className="text-[#6e6558] block">Next poll</span>
              <strong className="text-[#1c1914]">{formatTimestamp(poller.next_scheduled_at, tz)}</strong>
            </div>
            <div className="rounded-xl bg-[#f3eee4] px-3 py-2">
              <span className="text-[#6e6558] block">Success / Total</span>
              <strong className="text-[#1e4636]">
                {poller.successful_polls} / {poller.total_polls}
              </strong>
            </div>
            <div className="rounded-xl bg-[#f3eee4] px-3 py-2">
              <span className="text-[#6e6558] block">GitHub Rate Limit</span>
              <strong className="text-[#1c1914]">
                {poller.rate_limit_remaining ?? '—'} remaining
              </strong>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e7e0d2]">
          <h3 className="text-base font-medium text-[#1c1914]">Recent Poll Runs ({polls.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#e7e0d2] bg-[#f7f3ea]/80 text-[11px] uppercase tracking-wider text-[#6e6558]">
                <th className="py-2.5 pl-5 pr-3">ID</th>
                <th className="py-2.5 px-3">Timestamp ({tz})</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Duration</th>
                <th className="py-2.5 px-3 text-right">Releases</th>
                <th className="py-2.5 px-3 text-right">Assets</th>
                <th className="py-2.5 px-3 text-right">Total Downloads</th>
                <th className="py-2.5 px-3 text-right">New Delta</th>
                <th className="py-2.5 pl-3 pr-5 text-right">API Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ece5d7] tabular-nums">
              {polls.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#6e6558]">
                    No poll runs recorded yet.
                  </td>
                </tr>
              ) : (
                polls.map((r) => (
                  <tr key={r.id} className="hover:bg-[#f3eee4]/60">
                    <td className="py-2.5 pl-5 pr-3 font-mono text-[#6e6558]">#{r.id}</td>
                    <td className="py-2.5 px-3 text-[#1c1914]">{formatTimestamp(r.polled_at, tz)}</td>
                    <td className="py-2.5 px-3">
                      {r.status === 'ok' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[#1e4636] font-medium">
                          ok{r.is_baseline ? ' (baseline)' : ''}
                        </span>
                      ) : (
                        <span
                          className="inline-flex rounded-full bg-[#a4513a]/15 px-2 py-0.5 text-[#a4513a] font-medium"
                          title={r.error_message}
                        >
                          error: {r.error_message.slice(0, 48)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[#4a4338]">{r.duration_ms} ms</td>
                    <td className="py-2.5 px-3 text-right text-[#4a4338]">{r.releases_count}</td>
                    <td className="py-2.5 px-3 text-right text-[#4a4338]">{r.assets_count}</td>
                    <td className="py-2.5 px-3 text-right font-medium text-[#1c1914]">
                      {formatNumber(r.total_downloads)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-medium text-[#1e4636]">
                      {r.is_baseline ? '—' : `+${formatNumber(r.total_delta)}`}
                    </td>
                    <td className="py-2.5 pl-3 pr-5 text-right text-[#6e6558]">
                      {r.rate_limit_remaining ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
