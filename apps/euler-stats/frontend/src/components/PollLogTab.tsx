import type {
  NotificationStatusResponse,
  PlayPollRunRow,
  PlaySyncStatus,
  PollRunRow,
  PollerStatus,
} from '../lib/types';
import { formatNumber, formatTimestamp } from '../lib/format';
import { NotificationsCard } from './NotificationsCard';

interface PollLogTabProps {
  polls: PollRunRow[];
  poller: PollerStatus | null;
  playPolls: PlayPollRunRow[];
  playSync: PlaySyncStatus | null;
  notifications: NotificationStatusResponse | null;
  onRefreshNotifications: () => void;
  tz: string;
}

export function PollLogTab({
  polls,
  poller,
  playPolls,
  playSync,
  notifications,
  onRefreshNotifications,
  tz,
}: PollLogTabProps) {
  return (
    <div className="space-y-6">
      <NotificationsCard
        data={notifications}
        tz={tz}
        onRefresh={onRefreshNotifications}
      />

      {/* Google Play Hourly Sync Log */}
      <div className="space-y-3">
        {playSync && (
          <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-4 sm:p-5 shadow-xs flex flex-wrap items-center justify-between gap-3 sm:gap-4 text-sm">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-medium text-[#1c1914]">Google Play Store Hourly Collector</h2>
              <p className="text-xs text-[#6e6558] mt-0.5 break-words">
                Syncs <code className="text-[#1e4636]">{playSync.package_name}</code> every hour at{' '}
                <strong className="text-[#4a4338]">:01:05 UTC</strong>. Skips unchanged GCS CSV objects by ETag/MD5 and upserts changed rows &amp; hourly vitals without duplicates.
              </p>
            </div>
            <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2 sm:gap-3 text-xs tabular-nums w-full sm:w-auto">
              <div className="rounded-xl bg-[#f3eee4] px-2.5 sm:px-3 py-2">
                <span className="text-[11px] sm:text-xs text-[#6e6558] block">Next sync</span>
                <strong className="text-[#1c1914] break-all">{formatTimestamp(playSync.next_scheduled_at, tz)}</strong>
              </div>
              <div className="rounded-xl bg-[#f3eee4] px-2.5 sm:px-3 py-2">
                <span className="text-[11px] sm:text-xs text-[#6e6558] block">OK / Total</span>
                <strong className="text-[#1e4636]">
                  {playSync.successful_polls} / {playSync.total_polls}
                </strong>
              </div>
              <div className="rounded-xl bg-[#f3eee4] px-2.5 sm:px-3 py-2">
                <span className="text-[11px] sm:text-xs text-[#6e6558] block">GCS Cached</span>
                <strong className="text-[#1c1914]">{playSync.synced_files_count}</strong>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 shadow-xs overflow-hidden">
          <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-[#e7e0d2]">
            <h3 className="text-base font-medium text-[#1c1914]">
              Google Play Sync Runs ({playPolls.length})
            </h3>
          </div>

          {/* Mobile Card List */}
          <div className="md:hidden divide-y divide-[#ece5d7]">
            {playPolls.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#6e6558]">
                No Google Play sync runs recorded yet.
              </div>
            ) : (
              playPolls.map((r) => (
                <div key={r.id} className="p-3.5 text-xs space-y-1.5 tabular-nums">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[#6e6558]">#{r.id}</span>
                      <span className="font-medium text-[#1c1914] truncate">{formatTimestamp(r.polled_at, tz)}</span>
                    </div>
                    {r.status === 'ok' ? (
                      <span className="shrink-0 rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[11px] text-[#1e4636] font-medium">
                        ok · {r.duration_ms}ms
                      </span>
                    ) : (
                      <span
                        className="shrink-0 rounded-full bg-[#a4513a]/15 px-2 py-0.5 text-[11px] text-[#a4513a] font-medium"
                        title={r.error_message}
                      >
                        {r.status}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-[11px] text-[#4a4338]">
                    <div>
                      <span className="text-[#6e6558] block text-[10px]">GCS</span>
                      {r.gcs_objects_seen} ({r.gcs_objects_downloaded} Δ)
                    </div>
                    <div>
                      <span className="text-[#6e6558] block text-[10px]">CSV Rows</span>
                      <span className="font-medium text-[#1e4636]">{formatNumber(r.gcs_rows_upserted)}</span>
                    </div>
                    <div>
                      <span className="text-[#6e6558] block text-[10px]">Vitals</span>
                      {formatNumber(r.vitals_rows_upserted)}
                    </div>
                    <div className="text-right">
                      <span className="text-[#6e6558] block text-[10px]">Reviews</span>
                      {formatNumber(r.reviews_upserted)}
                    </div>
                  </div>
                  {r.status !== 'ok' && r.error_message && (
                    <div className="text-[11px] text-[#a4513a] break-words">{r.error_message}</div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#e7e0d2] bg-[#f7f3ea]/80 text-[11px] uppercase tracking-wider text-[#6e6558]">
                  <th className="py-2.5 pl-5 pr-3">ID</th>
                  <th className="py-2.5 px-3">Timestamp ({tz})</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Duration</th>
                  <th className="py-2.5 px-3 text-right">GCS Seen</th>
                  <th className="py-2.5 px-3 text-right">Changed Downloaded</th>
                  <th className="py-2.5 px-3 text-right">CSV Rows Upserted</th>
                  <th className="py-2.5 px-3 text-right">Vitals Upserted</th>
                  <th className="py-2.5 pl-3 pr-5 text-right">Reviews Upserted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ece5d7] tabular-nums">
                {playPolls.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-[#6e6558]">
                      No Google Play sync runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  playPolls.map((r) => (
                    <tr key={r.id} className="hover:bg-[#f3eee4]/60">
                      <td className="py-2.5 pl-5 pr-3 font-mono text-[#6e6558]">#{r.id}</td>
                      <td className="py-2.5 px-3 text-[#1c1914]">{formatTimestamp(r.polled_at, tz)}</td>
                      <td className="py-2.5 px-3">
                        {r.status === 'ok' ? (
                          <span className="inline-flex rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[#1e4636] font-medium">
                            ok
                          </span>
                        ) : (
                          <span
                            className="inline-flex rounded-full bg-[#a4513a]/15 px-2 py-0.5 text-[#a4513a] font-medium"
                            title={r.error_message}
                          >
                            {r.status}: {r.error_message.slice(0, 48)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#4a4338]">{r.duration_ms} ms</td>
                      <td className="py-2.5 px-3 text-right text-[#4a4338]">{r.gcs_objects_seen}</td>
                      <td className="py-2.5 px-3 text-right font-medium text-[#1c1914]">
                        {r.gcs_objects_downloaded}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#1e4636]">{formatNumber(r.gcs_rows_upserted)}</td>
                      <td className="py-2.5 px-3 text-right text-[#4a4338]">{formatNumber(r.vitals_rows_upserted)}</td>
                      <td className="py-2.5 pl-3 pr-5 text-right text-[#4a4338]">{formatNumber(r.reviews_upserted)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* GitHub Releases Hourly Poll Log */}
      <div className="space-y-3">
        {poller && (
          <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-4 sm:p-5 shadow-xs flex flex-wrap items-center justify-between gap-3 sm:gap-4 text-sm">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-medium text-[#1c1914]">GitHub Library Releases Hourly Collector</h2>
              <p className="text-xs text-[#6e6558] mt-0.5 break-words">
                Polls <code className="text-[#1e4636] break-all">api.github.com/repos/dawei7/professor-euler-library/releases</code>{' '}
                every hour at <strong className="text-[#4a4338]">:00:05 UTC</strong>.
              </p>
            </div>
            <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2 sm:gap-3 text-xs tabular-nums w-full sm:w-auto">
              <div className="rounded-xl bg-[#f3eee4] px-2.5 sm:px-3 py-2">
                <span className="text-[11px] sm:text-xs text-[#6e6558] block">Next poll</span>
                <strong className="text-[#1c1914] break-all">{formatTimestamp(poller.next_scheduled_at, tz)}</strong>
              </div>
              <div className="rounded-xl bg-[#f3eee4] px-2.5 sm:px-3 py-2">
                <span className="text-[11px] sm:text-xs text-[#6e6558] block">OK / Total</span>
                <strong className="text-[#1e4636]">
                  {poller.successful_polls} / {poller.total_polls}
                </strong>
              </div>
              <div className="rounded-xl bg-[#f3eee4] px-2.5 sm:px-3 py-2">
                <span className="text-[11px] sm:text-xs text-[#6e6558] block">API Left</span>
                <strong className="text-[#1c1914]">
                  {poller.rate_limit_remaining ?? '—'}
                </strong>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 shadow-xs overflow-hidden">
          <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-[#e7e0d2]">
            <h3 className="text-base font-medium text-[#1c1914]">Recent GitHub Poll Runs ({polls.length})</h3>
          </div>

          {/* Mobile Card List */}
          <div className="md:hidden divide-y divide-[#ece5d7]">
            {polls.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#6e6558]">
                No GitHub poll runs recorded yet.
              </div>
            ) : (
              polls.map((r) => (
                <div key={r.id} className="p-3.5 text-xs space-y-1.5 tabular-nums">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[#6e6558]">#{r.id}</span>
                      <span className="font-medium text-[#1c1914] truncate">{formatTimestamp(r.polled_at, tz)}</span>
                    </div>
                    {r.status === 'ok' ? (
                      <span className="shrink-0 rounded-full bg-[#1e4636]/12 px-2 py-0.5 text-[11px] text-[#1e4636] font-medium">
                        ok{r.is_baseline ? ' · base' : ''} · {r.duration_ms}ms
                      </span>
                    ) : (
                      <span
                        className="shrink-0 rounded-full bg-[#a4513a]/15 px-2 py-0.5 text-[11px] text-[#a4513a] font-medium"
                        title={r.error_message}
                      >
                        error
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-[11px] text-[#4a4338]">
                    <div>
                      <span className="text-[#6e6558] block text-[10px]">Total DL</span>
                      <span className="font-medium text-[#1c1914]">{formatNumber(r.total_downloads)}</span>
                    </div>
                    <div>
                      <span className="text-[#6e6558] block text-[10px]">New Delta</span>
                      <span className="font-medium text-[#1e4636]">
                        {r.is_baseline ? '—' : `+${formatNumber(r.total_delta)}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#6e6558] block text-[10px]">Rel / Asset</span>
                      {r.releases_count} / {r.assets_count}
                    </div>
                    <div className="text-right">
                      <span className="text-[#6e6558] block text-[10px]">API Left</span>
                      {r.rate_limit_remaining ?? '—'}
                    </div>
                  </div>
                  {r.status !== 'ok' && r.error_message && (
                    <div className="text-[11px] text-[#a4513a] break-words">{r.error_message}</div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
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
                    <td colSpan={9} className="py-6 text-center text-[#6e6558]">
                      No GitHub poll runs recorded yet.
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
    </div>
  );
}
