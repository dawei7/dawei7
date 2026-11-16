export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatRelativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'Never';
  const diffSec = Math.round((nowMs - new Date(iso).getTime()) / 1000);
  if (Math.abs(diffSec) < 45) return diffSec >= 0 ? 'just now' : `in ${Math.abs(diffSec)}s`;
  const absMin = Math.round(Math.abs(diffSec) / 60);
  if (absMin < 60) return diffSec >= 0 ? `${absMin}m ago` : `in ${absMin}m`;
  const absHr = Math.round(absMin / 60);
  if (absHr < 48) return diffSec >= 0 ? `${absHr}h ago` : `in ${absHr}h`;
  const absDay = Math.round(absHr / 24);
  return diffSec >= 0 ? `${absDay}d ago` : `in ${absDay}d`;
}

export function formatCountdown(targetIso: string | null | undefined, nowMs = Date.now()): string {
  if (!targetIso) return '—';
  const diffSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - nowMs) / 1000));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTimestamp(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function seriesColor(key: string, idx: number): string {
  const fixed: Record<string, string> = {
    curriculum: '#1e4636',
    books: '#8d6b32',
    en: '#1e4636',
    de: '#8d6b32',
    tablet: '#1e4636',
    phone: '#2b6b74',
    all: '#8d6b32',
    other: '#7f7567',
    total: '#1e4636',
  };
  if (fixed[key]) return fixed[key];
  const palette = ['#1e4636', '#8d6b32', '#2b6b74', '#a4513a', '#4d6b3c', '#69547b'];
  return palette[idx % palette.length];
}

export function seriesLabel(key: string): string {
  const labels: Record<string, string> = {
    curriculum: 'Curriculum',
    books: 'Open Books & Assets',
    en: 'English',
    de: 'German',
    tablet: 'Tablet / Desktop',
    phone: 'Phone Edition',
    all: 'Universal / Books',
    other: 'Other',
    total: 'Total Downloads',
  };
  return labels[key] ?? key;
}

export function languageBadge(lang: string): string {
  switch (lang) {
    case 'en':
      return 'EN';
    case 'de':
      return 'DE';
    case 'all':
      return 'ALL';
    default:
      return lang.toUpperCase();
  }
}

export function editionLabel(edition: string): string {
  switch (edition) {
    case 'tablet':
      return 'Tablet';
    case 'phone':
      return 'Phone';
    case 'all':
      return 'Universal';
    default:
      return edition;
  }
}
