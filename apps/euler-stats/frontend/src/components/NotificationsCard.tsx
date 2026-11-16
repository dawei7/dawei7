import { useEffect, useState } from 'react';
import type {
  NotificationSettingsUpdate,
  NotificationStatusResponse,
} from '../lib/types';
import { formatTimestamp } from '../lib/format';
import { sendTestNotification, updateNotificationSettings } from '../lib/api';

interface NotificationsCardProps {
  data: NotificationStatusResponse | null;
  tz: string;
  onRefresh: () => void;
}

const ADMIN_TOKEN_STORAGE_KEY = 'euler_stats_admin_token';

function eventLabel(ev: string): string {
  switch (ev) {
    case 'play_crash':
      return 'Play Crash';
    case 'asset_downloads':
      return 'Asset Delta';
    case 'test':
      return 'Test Email';
    default:
      return ev;
  }
}

export function NotificationsCard({ data, tz, onRefresh }: NotificationsCardProps) {
  const [editing, setEditing] = useState(false);
  const [adminToken, setAdminToken] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [form, setForm] = useState<NotificationSettingsUpdate>({
    enabled: true,
    recipient_email: 'ai.professor.euler@gmail.com',
    crash_alerts_enabled: true,
    crash_min_version_code: 0,
    include_anrs: false,
    download_alerts_enabled: true,
    min_download_delta: 1,
    reset_crash_baseline: false,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: data.settings.enabled,
      recipient_email: data.settings.recipient_email,
      crash_alerts_enabled: data.settings.crash_alerts_enabled,
      crash_min_version_code: data.settings.crash_min_version_code,
      include_anrs: data.settings.include_anrs,
      download_alerts_enabled: data.settings.download_alerts_enabled,
      min_download_delta: data.settings.min_download_delta,
      reset_crash_baseline: false,
    });
  }, [data]);

  if (!data) return null;

  const { settings, smtp, admin_protected, logs } = data;

  const persistToken = (val: string) => {
    setAdminToken(val);
    try {
      sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, val);
    } catch {
      // ignore storage errors
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await updateNotificationSettings(form, adminToken);
      setFeedback({ kind: 'ok', text: 'Alert settings saved.' });
      setForm((p) => ({ ...p, reset_crash_baseline: false }));
      onRefresh();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to update settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await sendTestNotification(adminToken);
      if (res.entry.status === 'sent') {
        setFeedback({ kind: 'ok', text: `Test email sent to ${res.entry.recipient}.` });
      } else {
        setFeedback({
          kind: 'err',
          text: `${res.entry.status}: ${res.error || res.entry.error_message || 'Email not delivered'}`,
        });
      }
      onRefresh();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to send test email',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-medium text-[#1c1914]">
                Gmail Alert Notification Service
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  smtp.configured && settings.enabled
                    ? 'bg-[#1e4636]/12 text-[#1e4636]'
                    : 'bg-[#8d6b32]/15 text-[#725524]'
                }`}
              >
                {smtp.configured
                  ? settings.enabled
                    ? 'Gmail Active'
                    : 'Paused'
                  : 'SMTP App Password Needed'}
              </span>
            </div>
            <p className="text-xs text-[#6e6558] mt-0.5 break-all sm:break-normal">
              Sender: <strong className="text-[#1c1914]">{smtp.username}</strong> ({smtp.host}:{smtp.port}) → To:{' '}
              <strong className="text-[#1c1914]">{settings.recipient_email}</strong>
            </p>
          </div>

          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-full border border-[#d5cdb8] bg-[#f3eee4] px-3 py-1.5 text-xs font-medium text-[#1c1914] hover:border-[#1e4636] cursor-pointer"
          >
            {editing ? 'Hide Settings' : 'Configure / Test'}
          </button>
        </div>

        {/* Current Rule Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="rounded-xl bg-[#f3eee4] px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-[#1c1914]">Post-Update Crash Alerts</div>
              <div className="text-[11px] text-[#6e6558]">
                Since {formatTimestamp(settings.crash_since, tz)}
                {settings.crash_min_version_code > 0
                  ? ` · vCode ≥ ${settings.crash_min_version_code}`
                  : ' · all versions'}
                {settings.include_anrs ? ' · +ANRs' : ''}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                settings.enabled && settings.crash_alerts_enabled
                  ? 'bg-[#1e4636]/12 text-[#1e4636]'
                  : 'bg-[#d5cdb8]/60 text-[#6e6558]'
              }`}
            >
              {settings.enabled && settings.crash_alerts_enabled ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="rounded-xl bg-[#f3eee4] px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-[#1c1914]">Asset Download Delta Alerts</div>
              <div className="text-[11px] text-[#6e6558]">
                Reports itemized asset delta when new downloads ≥ {settings.min_download_delta}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                settings.enabled && settings.download_alerts_enabled
                  ? 'bg-[#1e4636]/12 text-[#1e4636]'
                  : 'bg-[#d5cdb8]/60 text-[#6e6558]'
              }`}
            >
              {settings.enabled && settings.download_alerts_enabled ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {!smtp.configured && (
          <div className="rounded-xl border border-[#8d6b32]/35 bg-[#8d6b32]/10 px-3.5 py-2.5 text-xs text-[#4a4338]">
            <strong>Setup needed to deliver Gmail emails:</strong> add a 16-character Google App Password for{' '}
            <code>{smtp.username}</code> as GitHub Secret <code>EULER_STATS_SMTP_PASSWORD</code> (or{' '}
            <code>SMTP_PASSWORD</code> in server <code>.env</code>). Until then, alerts are still detected and logged below.
          </div>
        )}

        {/* Expandable Admin Settings & Test Email Form */}
        {editing && (
          <form onSubmit={handleSave} className="pt-3 border-t border-[#ece5d7] space-y-3 text-xs">
            {!admin_protected ? (
              <div className="rounded-xl border border-[#8d6b32]/35 bg-[#8d6b32]/10 px-3 py-2 text-[#4a4338]">
                Settings editing and manual test emails require <code>EULER_STATS_ADMIN_SECRET</code> to be configured on the server so public visitors cannot trigger emails.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  <label className="space-y-1">
                    <span className="text-[#6e6558] block">Admin Secret (Bearer)</span>
                    <input
                      type="password"
                      value={adminToken}
                      onChange={(e) => persistToken(e.target.value)}
                      placeholder="EULER_STATS_ADMIN_SECRET"
                      className="w-full rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1.5 text-sm sm:text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6e6558] block">Recipient Email</span>
                    <input
                      type="email"
                      required
                      value={form.recipient_email}
                      onChange={(e) => setForm((p) => ({ ...p, recipient_email: e.target.value }))}
                      className="w-full rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1.5 text-sm sm:text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6e6558] block">Min Download Delta</span>
                    <input
                      type="number"
                      min={1}
                      value={form.min_download_delta}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, min_download_delta: Math.max(1, Number(e.target.value) || 1) }))
                      }
                      className="w-full rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1.5 text-sm sm:text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6e6558] block">Min Play Version Code (0 = all)</span>
                    <input
                      type="number"
                      min={0}
                      value={form.crash_min_version_code}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, crash_min_version_code: Math.max(0, Number(e.target.value) || 0) }))
                      }
                      className="w-full rounded-lg border border-[#d5cdb8] bg-[#fffcf6] px-2.5 py-1.5 text-sm sm:text-xs"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-2 text-[#1c1914]">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                    />
                    Notifications Enabled
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.crash_alerts_enabled}
                      onChange={(e) => setForm((p) => ({ ...p, crash_alerts_enabled: e.target.checked }))}
                    />
                    Play Crash Alerts
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.include_anrs}
                      onChange={(e) => setForm((p) => ({ ...p, include_anrs: e.target.checked }))}
                    />
                    Include ANRs
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.download_alerts_enabled}
                      onChange={(e) => setForm((p) => ({ ...p, download_alerts_enabled: e.target.checked }))}
                    />
                    Asset Download Alerts
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.reset_crash_baseline}
                      onChange={(e) => setForm((p) => ({ ...p, reset_crash_baseline: e.target.checked }))}
                    />
                    Reset crash baseline to now
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={saving || !adminToken.trim()}
                    className="rounded-full bg-[#1e4636] px-4 py-1.5 font-medium text-[#faf7f1] disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? 'Saving...' : 'Save Settings'}
                  </button>
                  <button
                    type="button"
                    disabled={testing || !adminToken.trim()}
                    onClick={() => void handleTest()}
                    className="rounded-full border border-[#8d6b32] bg-[#fffcf6] px-4 py-1.5 font-medium text-[#8d6b32] disabled:opacity-50 cursor-pointer"
                  >
                    {testing ? 'Sending...' : 'Send Test Email'}
                  </button>
                </div>
              </>
            )}

            {feedback && (
              <div
                className={`rounded-xl px-3 py-2 ${
                  feedback.kind === 'ok'
                    ? 'bg-[#1e4636]/12 text-[#1e4636]'
                    : 'bg-[#a4513a]/12 text-[#a4513a]'
                }`}
              >
                {feedback.text}
              </div>
            )}
          </form>
        )}
      </div>

      {/* Recent Notification Log */}
      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-[#e7e0d2]">
          <h3 className="text-base font-medium text-[#1c1914]">
            Recent Email Notifications ({logs.length})
          </h3>
        </div>

        {/* Mobile Card List */}
        <div className="md:hidden divide-y divide-[#ece5d7]">
          {logs.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#6e6558]">
              No notifications triggered yet (will fire automatically when downloads change or crashes occur).
            </div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-[#f3eee4] px-2 py-0.5 text-[11px] font-medium text-[#1c1914]">
                    {eventLabel(entry.event_type)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      entry.status === 'sent'
                        ? 'bg-[#1e4636]/12 text-[#1e4636]'
                        : entry.status === 'skipped'
                          ? 'bg-[#8d6b32]/15 text-[#725524]'
                          : 'bg-[#a4513a]/15 text-[#a4513a]'
                    }`}
                  >
                    {entry.status}
                  </span>
                </div>
                <div className="font-medium text-[#1c1914]">{entry.subject}</div>
                <div className="text-[11px] text-[#6e6558] tabular-nums">
                  {formatTimestamp(entry.created_at, tz)} → {entry.recipient}
                </div>
                {entry.error_message && (
                  <div className="text-[11px] text-[#a4513a] break-words">{entry.error_message}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#e7e0d2] bg-[#f7f3ea]/80 text-[11px] uppercase tracking-wider text-[#6e6558]">
                <th className="py-2.5 pl-5 pr-3">Time ({tz})</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Recipient</th>
                <th className="py-2.5 pl-3 pr-5">Subject / Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ece5d7]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#6e6558]">
                    No notifications triggered yet.
                  </td>
                </tr>
              ) : (
                logs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#f3eee4]/60">
                    <td className="py-2.5 pl-5 pr-3 text-[#4a4338] whitespace-nowrap tabular-nums">
                      {formatTimestamp(entry.created_at, tz)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="rounded-full bg-[#f3eee4] px-2 py-0.5 font-medium text-[#1c1914]">
                        {eventLabel(entry.event_type)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          entry.status === 'sent'
                            ? 'bg-[#1e4636]/12 text-[#1e4636]'
                            : entry.status === 'skipped'
                              ? 'bg-[#8d6b32]/15 text-[#725524]'
                              : 'bg-[#a4513a]/15 text-[#a4513a]'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[#4a4338]">{entry.recipient}</td>
                    <td className="py-2.5 pl-3 pr-5 text-[#1c1914]">
                      <div className="font-medium">{entry.subject}</div>
                      {entry.error_message && (
                        <div className="text-[11px] text-[#a4513a]">{entry.error_message}</div>
                      )}
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
