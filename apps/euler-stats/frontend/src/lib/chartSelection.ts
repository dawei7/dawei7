import type { Granularity, TimeRangeSelection } from './types';

interface TimestampPoint {
  timestamp: string;
  label: string;
}

/**
 * Formats an ISO timestamp as YYYY-MM-DD in the given IANA timezone.
 */
export function formatDateInTz(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function addDaysYYYYMMDD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function lastDayOfMonthYYYYMMDD(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m, 0));
  return dt.toISOString().slice(0, 10);
}

/**
 * Builds a start/end range selection covering buckets [lo..hi] inclusive.
 * Calendar-day mode produces YYYY-MM-DD bounds for Play daily tables;
 * timestamp mode produces RFC3339 bounds for Library & hourly vitals.
 */
export function buildBucketSelection(
  points: TimestampPoint[],
  loIdx: number,
  hiIdx: number,
  gran: Granularity,
  tz: string,
  calendarMode: boolean,
): TimeRangeSelection | null {
  if (points.length === 0) return null;
  const lo = Math.max(0, Math.min(loIdx, hiIdx));
  const hi = Math.min(points.length - 1, Math.max(loIdx, hiIdx));
  const startPt = points[lo];
  const endPt = points[hi];
  const label = lo === hi ? startPt.label : `${startPt.label} → ${endPt.label}`;

  if (calendarMode && gran !== 'hour') {
    const from = formatDateInTz(startPt.timestamp, tz);
    let to = formatDateInTz(endPt.timestamp, tz);
    if (hi + 1 < points.length) {
      to = addDaysYYYYMMDD(formatDateInTz(points[hi + 1].timestamp, tz), -1);
    } else if (gran === 'week') {
      to = addDaysYYYYMMDD(to, 6);
    } else if (gran === 'month') {
      to = lastDayOfMonthYYYYMMDD(to);
    }
    if (to < from) to = from;
    return { from, to, label };
  }

  if (gran === 'day' && !calendarMode) {
    const from = formatDateInTz(startPt.timestamp, tz);
    const to = formatDateInTz(endPt.timestamp, tz);
    return { from, to, label };
  }

  const from = startPt.timestamp;
  let to: string;
  if (hi + 1 < points.length) {
    to = new Date(new Date(points[hi + 1].timestamp).getTime() - 1).toISOString();
  } else if (gran === 'hour') {
    to = new Date(new Date(endPt.timestamp).getTime() + 3600_000 - 1).toISOString();
  } else if (gran === '6h') {
    to = new Date(new Date(endPt.timestamp).getTime() + 6 * 3600_000 - 1).toISOString();
  } else if (gran === 'week') {
    to = addDaysYYYYMMDD(formatDateInTz(endPt.timestamp, tz), 6);
  } else {
    to = lastDayOfMonthYYYYMMDD(formatDateInTz(endPt.timestamp, tz));
  }
  return { from, to, label };
}

/**
 * Checks whether a chart bucket timestamp falls inside the active TimeRangeSelection.
 */
export function isBucketInSelection(
  iso: string,
  selection: TimeRangeSelection | null,
  tz: string,
): boolean {
  if (!selection) return false;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(selection.from) && /^\d{4}-\d{2}-\d{2}$/.test(selection.to);
  if (isDateOnly) {
    const d = formatDateInTz(iso, tz);
    return d >= selection.from && d <= selection.to;
  }
  const t = new Date(iso).getTime();
  const f = new Date(selection.from).getTime();
  const endMs = /^\d{4}-\d{2}-\d{2}$/.test(selection.to)
    ? new Date(`${selection.to}T23:59:59.999Z`).getTime()
    : new Date(selection.to).getTime();
  return t >= f && t <= endMs;
}
