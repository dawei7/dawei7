// ── Bible data types ─────────────────────────────────────────────────────────

export type Verse = string;
export type Chapter = Verse[];

export interface Book {
  name: string;
  abbrev?: string;
  chapters: Chapter[];
}

export type Bible = Book[];

// ── Version catalog ───────────────────────────────────────────────────────────

export interface BibleVersionMeta {
  name: string;
  abbreviation: string;
  language: string;
}

export interface BibleVersionGroup {
  language: string;
  versions: { name: string; abbreviation: string }[];
}

// ── App modes ─────────────────────────────────────────────────────────────────

export type AppMode = 'read' | 'search' | 'prophecy';
export type Theme = 'system' | 'light' | 'dark';
export type SearchMode = 'all' | 'any' | 'phrase';
export type VerseLayout = 'blocks' | 'continuous';
export type NumberStyle = 'inline' | 'superscript';
export type FontFamily = 'sans' | 'serif';

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchObject {
  regexes: RegExp[];
  mode: SearchMode;
  query: string;
}

export interface SearchResultRow {
  bookName: string;
  bookAbbrev: string;
  chapter: number;
  verse: number;
  text: string;
  count: number;
}

export interface SearchResults {
  rows: SearchResultRow[];
  total: number;
  perBook: Record<string, number>;
  perChap: Record<string, number>;
  exceeded: boolean;
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

export interface Bookmark {
  id: string;
  version: string;
  bookIdx: number;
  bookName: string;
  chapterIdx: number;
  verseStart: number;
  verseEnd: number;
  note?: string;
  createdAt: number;
}

// ── Prophecy ─────────────────────────────────────────────────────────────────

export interface ProphecySummaryLine {
  prophecy: string;
  fulfillment: string;
}

export interface ProphecySummary extends ProphecySummaryLine {
  en: ProphecySummaryLine;
  de: ProphecySummaryLine;
}

export interface ProphecyFulfillment {
  biblicalRef: string;
  externalRef?: { en: string; de: string };
}

export interface Prophecy {
  id: string | number;
  prophecyRef: string;
  summary: ProphecySummary;
  category?: { en: string; de: string };
  status?: string;
  fulfillment?: ProphecyFulfillment;
  notes?: { en: string; de: string };
  tags?: string[];
}

// ── Reading position ──────────────────────────────────────────────────────────

export interface ReadingPosition {
  bookIdx: number;
  chapterIdx: number;
  vStart: number;
  vEnd: number;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface AppSettings {
  theme: Theme;
  readerFontSize: number;
  readerFontFamily: FontFamily;
  lineHeightPx: number;
  readerWidthPct: number;
  verseLayout: VerseLayout;
  showNumbers: boolean;
  numberStyle: NumberStyle;
  justifyText: boolean;
  hoverHighlight: boolean;
  autoHighlightInRead: boolean;
}
