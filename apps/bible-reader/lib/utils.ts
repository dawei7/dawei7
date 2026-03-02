import type { SearchMode, SearchObject, Bible, Book } from './types';

// ── General utilities ─────────────────────────────────────────────────────────

export function cn(...args: (string | undefined | null | false)[]): string {
  return args.filter(Boolean).join(' ');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function formatMinutes(m: number): string {
  if (!m || m <= 0) return '—';
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0 && min > 0) return `${h}h ${min}m`;
  if (h > 0) return `${h}h`;
  return `${min}m`;
}

// ── Search utilities ──────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSearchRegex(
  query: string,
  mode: SearchMode,
  opts: { wholeWords?: boolean; caseSensitive?: boolean } = {}
): SearchObject | null {
  const { wholeWords = false, caseSensitive = false } = opts;
  const raw = query.trim();
  if (!raw) return null;

  const flags = caseSensitive ? 'g' : 'gi';
  const wb = (s: string) => (wholeWords ? `\\b${s}\\b` : s);

  let regexes: RegExp[];

  if (mode === 'phrase') {
    regexes = [new RegExp(wb(escapeRegex(raw)), flags)];
  } else if (mode === 'any') {
    const terms = raw.split(/\s+/).filter(Boolean).map(escapeRegex);
    regexes = terms.map((t) => new RegExp(wb(t), flags));
  } else {
    // 'all' – every word must appear (separate regexes, all must match)
    const terms = raw.split(/\s+/).filter(Boolean).map(escapeRegex);
    regexes = terms.map((t) => new RegExp(wb(t), flags));
  }

  return { regexes, mode, query: raw };
}

export function matchesSearch(text: string, obj: SearchObject): number {
  if (obj.mode === 'all') {
    if (!obj.regexes.every((r) => { r.lastIndex = 0; return r.test(text); })) return 0;
    return obj.regexes.reduce((acc, r) => {
      r.lastIndex = 0;
      const m = text.match(new RegExp(r.source, r.flags.replace('g', '')));
      return acc + (m?.length ?? 0);
    }, 0);
  }
  if (obj.mode === 'any') {
    let count = 0;
    for (const r of obj.regexes) {
      r.lastIndex = 0;
      const m = text.match(new RegExp(r.source, r.flags));
      if (m) count += m.length;
    }
    return count;
  }
  // phrase
  const r = obj.regexes[0];
  r.lastIndex = 0;
  const m = text.match(new RegExp(r.source, r.flags));
  return m?.length ?? 0;
}

// ── Bible utilities ───────────────────────────────────────────────────────────

export const BOOK_ABBREV_MAP: Record<string, string> = {
  'Genesis': 'Gen', 'Exodus': 'Exod', 'Leviticus': 'Lev', 'Numbers': 'Num',
  'Deuteronomy': 'Deut', 'Joshua': 'Josh', 'Judges': 'Judg', 'Ruth': 'Ruth',
  '1 Samuel': '1Sam', '2 Samuel': '2Sam', '1 Kings': '1Kgs', '2 Kings': '2Kgs',
  '1 Chronicles': '1Chr', '2 Chronicles': '2Chr', 'Ezra': 'Ezra', 'Nehemiah': 'Neh',
  'Esther': 'Esth', 'Job': 'Job', 'Psalms': 'Ps', 'Proverbs': 'Prov',
  'Ecclesiastes': 'Eccl', 'Song of Solomon': 'Song', 'Isaiah': 'Isa',
  'Jeremiah': 'Jer', 'Lamentations': 'Lam', 'Ezekiel': 'Ezek', 'Daniel': 'Dan',
  'Hosea': 'Hos', 'Joel': 'Joel', 'Amos': 'Amos', 'Obadiah': 'Obad',
  'Jonah': 'Jonah', 'Micah': 'Mic', 'Nahum': 'Nah', 'Habakkuk': 'Hab',
  'Zephaniah': 'Zeph', 'Haggai': 'Hag', 'Zechariah': 'Zech', 'Malachi': 'Mal',
  'Matthew': 'Matt', 'Mark': 'Mark', 'Luke': 'Luke', 'John': 'John',
  'Acts': 'Acts', 'Romans': 'Rom', '1 Corinthians': '1Cor', '2 Corinthians': '2Cor',
  'Galatians': 'Gal', 'Ephesians': 'Eph', 'Philippians': 'Phil', 'Colossians': 'Col',
  '1 Thessalonians': '1Thess', '2 Thessalonians': '2Thess', '1 Timothy': '1Tim',
  '2 Timothy': '2Tim', 'Titus': 'Titus', 'Philemon': 'Phlm', 'Hebrews': 'Heb',
  'James': 'Jas', '1 Peter': '1Pet', '2 Peter': '2Pet', '1 John': '1John',
  '2 John': '2John', '3 John': '3John', 'Jude': 'Jude', 'Revelation': 'Rev',
};

export const CANONICAL_ORDER = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges',
  'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes',
  'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke', 'John',
  'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter',
  '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

function normalizeNameForMap(n: string): string {
  let s = String(n).trim();
  s = s.replace(/^Song of Songs$/i, 'Song of Solomon');
  s = s.replace(/^Canticles$/i, 'Song of Solomon');
  s = s.replace(/^The Revelation( of John)?$/i, 'Revelation');
  s = s.replace(/^Psalm(s)?$/i, 'Psalms');
  s = s.replace(/^1st /, '1 ').replace(/^2nd /, '2 ').replace(/^3rd /, '3 ');
  return s.replace(/\b(\w)/g, (m) => m.toUpperCase());
}

export function bookAbbrev(name: string, fallback?: string): string {
  if (fallback && typeof fallback === 'string') return fallback;
  const key = normalizeNameForMap(name);
  return BOOK_ABBREV_MAP[key] ?? name.slice(0, 3).toUpperCase();
}

export function normalizeBible(data: Bible): void {
  data.forEach((b) => {
    if (!b.name) b.name = b.abbrev ? String(b.abbrev).toUpperCase() : 'Unknown';
    if (!b.abbrev) b.abbrev = bookAbbrev(b.name);
  });
}

export function validateBibleStructure(raw: unknown): raw is Bible {
  return (
    Array.isArray(raw) &&
    (raw as unknown[]).every(
      (b) => b && typeof b === 'object' && Array.isArray((b as Book).chapters)
    )
  );
}

export function coerceBible(raw: unknown): Bible {
  if (validateBibleStructure(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const cand = r.books ?? r.bible ?? r.data;
    if (validateBibleStructure(cand)) return cand;
  }
  throw new Error('Invalid Bible JSON format');
}

export function extractVersesFromRef(
  ref: string,
  bible: Bible,
  canonicalBooks: string[]
): string {
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return '';
  const rawBook = m[1];
  const chap = parseInt(m[2], 10) - 1;
  const vStart = parseInt(m[3], 10);
  const vEnd = m[4] ? parseInt(m[4], 10) : vStart;
  const bookCanonIdx = canonicalBooks.findIndex(
    (cb) =>
      cb.toLowerCase() === rawBook.toLowerCase() ||
      cb.toLowerCase().startsWith(rawBook.toLowerCase())
  );
  if (bookCanonIdx < 0 || bookCanonIdx >= bible.length) return '';
  const book = bible[bookCanonIdx];
  const chapterArr = book?.chapters?.[chap];
  if (!Array.isArray(chapterArr)) return '';
  const start = Math.max(1, vStart);
  const end = Math.max(start, vEnd);
  return chapterArr
    .slice(start - 1, end)
    .map((v, i) => `${start + i}. ${v}`)
    .join('\n');
}

export function defaultLocaleFor(code: string): string {
  const map: Record<string, string> = {
    en: 'en-US', de: 'de-DE', zh: 'zh-CN', es: 'es-ES',
    pt: 'pt-PT', fr: 'fr-FR', ru: 'ru-RU', ro: 'ro-RO',
    vi: 'vi-VN', el: 'el-GR', ko: 'ko-KR', fi: 'fi-FI',
    ar: 'ar-SA', eo: 'eo',
  };
  return map[(code || '').toLowerCase()] ?? code ?? 'en-US';
}
