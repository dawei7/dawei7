'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useBible } from '@/hooks/useBible';
import { useSearch } from '@/hooks/useSearch';
import { useTTS } from '@/hooks/useTTS';
import { useBookmarks } from '@/hooks/useBookmarks';
import type { AppMode, Theme, VerseLayout, NumberStyle, FontFamily, SearchMode, Prophecy } from '@/lib/types';
import ReadPane from './ReadPane';
import SearchPane from './SearchPane';
import ProphecyPane from './ProphecyPane';
import ControlsOverlay from './ControlsOverlay';

// ── Storage helpers ───────────────────────────────────────────────────────────
function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return JSON.parse(v) as T;
  } catch { /* noop */ }
  return fallback;
}
function writeLS(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

// ── Theme management ──────────────────────────────────────────────────────────
function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  writeLS('br_theme', theme);
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BibleApp() {
  // Bible / version
  const {
    bible, version, versions, loadingVersion, versionError,
    bookIdx, setBookIdx, chapterIdx, setChapterIdx,
    vStart, setVStart, vEnd, setVEnd,
    loadBibleVersion,
  } = useBible();

  // App state
  const [mode, setMode] = useState<AppMode>('read');
  const [showControls, setShowControls] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('all');
  const [wholeWords, setWholeWords] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchScope, setSearchScope] = useState<'all' | 'book'>('all');
  const [showStats, setShowStats] = useState(true);
  const [bookFilter, setBookFilter] = useState<string | null>(null);
  const [chapFilter, setChapFilter] = useState<string | null>(null);

  // Settings (read from localStorage on first render)
  const [theme, setThemeState] = useState<Theme>(() => readLS('br_theme', 'system' as Theme));
  const [fontSize, setFontSize] = useState<number>(() => readLS('br_fontSize', 16));
  const [fontFamily, setFontFamily] = useState<FontFamily>(() => readLS('br_fontFamily', 'sans' as FontFamily));
  const [lineHeightPx, setLineHeightPx] = useState<number>(() => readLS('br_lineHeight', 28));
  const [readerWidthPct, setReaderWidthPct] = useState<number>(() => readLS('br_widthPct', 100));
  const [verseLayout, setVerseLayout] = useState<VerseLayout>(() => readLS('br_verseLayout', 'blocks' as VerseLayout));
  const [showNumbers, setShowNumbers] = useState<boolean>(() => readLS('br_showNumbers', true));
  const [numberStyle, setNumberStyle] = useState<NumberStyle>(() => readLS('br_numberStyle', 'superscript' as NumberStyle));
  const [justifyText, setJustifyText] = useState<boolean>(() => readLS('br_justifyText', false));
  const [hoverHighlight, setHoverHighlight] = useState<boolean>(() => readLS('br_hoverHighlight', true));
  const [autoHighlightInRead, setAutoHighlightInRead] = useState<boolean>(() => readLS('br_autoHighlight', false));

  // Track which verse to scroll to when jumping from search
  const [scrollToVerse, setScrollToVerse] = useState(0);

  // Persist settings
  useEffect(() => { writeLS('br_fontSize', fontSize); }, [fontSize]);
  useEffect(() => { writeLS('br_fontFamily', fontFamily); }, [fontFamily]);
  useEffect(() => { writeLS('br_lineHeight', lineHeightPx); }, [lineHeightPx]);
  useEffect(() => { writeLS('br_widthPct', readerWidthPct); }, [readerWidthPct]);
  useEffect(() => { writeLS('br_verseLayout', verseLayout); }, [verseLayout]);
  useEffect(() => { writeLS('br_showNumbers', showNumbers); }, [showNumbers]);
  useEffect(() => { writeLS('br_numberStyle', numberStyle); }, [numberStyle]);
  useEffect(() => { writeLS('br_justifyText', justifyText); }, [justifyText]);
  useEffect(() => { writeLS('br_hoverHighlight', hoverHighlight); }, [hoverHighlight]);
  useEffect(() => { writeLS('br_autoHighlight', autoHighlightInRead); }, [autoHighlightInRead]);

  // Theme
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  }, []);
  useEffect(() => { applyTheme(theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prophecies
  const [prophecies, setProphecies] = useState<Prophecy[]>([]);
  const [prophecyError, setProphecyError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/prophecies.json');
        if (!res.ok) return; // not found is fine
        const data = await res.json();
        if (Array.isArray(data)) setProphecies(data as Prophecy[]);
      } catch (e) {
        setProphecyError(String((e as Error)?.message ?? e));
      }
    })();
  }, []);

  // Clear search filters when the query changes
  useEffect(() => { setBookFilter(null); setChapFilter(null); }, [query]);

  // Search
  const { searchObj, searchResults } = useSearch(bible, query, searchMode, {
    wholeWords,
    caseSensitive,
    searchScope,
    bookIdx,
  });

  // TTS
  const versionLangCode = useMemo(() => {
    if (!version) return 'en';
    return version.split('_')[0].slice(0, 2).toLowerCase();
  }, [version]);
  const tts = useTTS(versionLangCode);

  const handleStartTTS = useCallback(
    (fromVerseIdx: number) => {
      if (!bible) return;
      const book = bible[bookIdx];
      if (!book) return;
      const chapter = book.chapters[chapterIdx] ?? [];
      const vEndEff = vEnd === 0 ? chapter.length : Math.min(vEnd, chapter.length);
      const vStartEff = Math.max(vStart, 1);
      const verses = chapter.slice(vStartEff - 1, vEndEff);
      tts.play(verses, fromVerseIdx);
    },
    [bible, bookIdx, chapterIdx, vStart, vEnd, tts]
  );

  // Jump to a specific reference (from search results)
  const jumpTo = useCallback(
    (bookName: string, chapter: number, verse: number) => {
      if (!bible) return;
      const idx = bible.findIndex((b) => b.name === bookName);
      if (idx < 0) return;
      setBookIdx(idx);
      setChapterIdx(chapter - 1);
      setVStart(1);        // always start from verse 1
      setVEnd(0);          // show full chapter
      setScrollToVerse(verse); // scroll to the matched verse
      setAutoHighlightInRead(true); // highlight the search term
      setMode('read');
    },
    [bible, setBookIdx, setChapterIdx, setVStart, setVEnd]
  );

  // ── Render loading state ─────────────────────────────────────────────────
  if (!bible) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-6">
        <div className="text-center space-y-4 max-w-md">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600 text-white grid place-content-center font-black text-2xl mx-auto select-none">
            ΑΩ
          </div>
          <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">Loading Bible…</div>
          {versionError && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3">
              {versionError}
            </div>
          )}
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {versions.length > 0
              ? `Found ${versions.length} version${versions.length !== 1 ? 's' : ''} — loading…`
              : 'Fetching version catalog…'}
          </div>
        </div>
      </div>
    );
  }

  const book = bible[bookIdx];
  const MODES: { key: AppMode; label: string }[] = [
    { key: 'read', label: 'Read' },
    { key: 'search', label: 'Search' },
    { key: 'prophecy', label: 'Prophecy' },
  ];

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-gradient-to-br from-white via-slate-50 to-zinc-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800 text-slate-900 dark:text-slate-100 transition-colors">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur shadow-sm border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div className="w-full px-4 py-3 flex items-center gap-3">
          {/* Logo */}
          <div className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600 text-white grid place-content-center font-black tracking-tight text-lg select-none">
            ΑΩ
          </div>
          <div className="hidden sm:block min-w-0">
            <h1 className="text-base font-semibold tracking-tight truncate">Bible Reader · Smart Search</h1>
            <p className="text-[10px] font-medium bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Alpha · Omega
            </p>
          </div>

          {/* Mode tabs */}
          <div className="ml-auto flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  mode === m.key
                    ? 'bg-white dark:bg-slate-700 shadow border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Controls toggle */}
          <button
            onClick={() => setShowControls(true)}
            className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 dark:border-slate-600 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            title="Controls & Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </div>

        {/* Reading progress bar (read mode) */}
        {mode === 'read' && (
          <div className="px-4 pb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-200 truncate">
              {book?.name}
            </span>
            <span>·</span>
            <span>Chapter {chapterIdx + 1}</span>
            <span>·</span>
            <span className="text-slate-400 dark:text-slate-500 text-[11px] truncate">
              {versions.find((v) => v.abbreviation === version)?.name ?? version}
            </span>
            {tts.status !== 'idle' && (
              <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-[10px] font-medium">
                {tts.status === 'playing' ? '▶ Reading' : '⏸ Paused'}
              </span>
            )}
          </div>
        )}
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {mode === 'read' && (
          <ReadPane
            bible={bible}
            version={version}
            bookIdx={bookIdx}
            chapterIdx={chapterIdx}
            vStart={vStart}
            vEnd={vEnd}
            setBookIdx={setBookIdx}
            setChapterIdx={setChapterIdx}
            setVStart={setVStart}
            setVEnd={setVEnd}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeightPx={lineHeightPx}
            readerWidthPct={readerWidthPct}
            verseLayout={verseLayout}
            showNumbers={showNumbers}
            numberStyle={numberStyle}
            justifyText={justifyText}
            hoverHighlight={hoverHighlight}
            autoHighlightSearchInRead={autoHighlightInRead}
            searchObj={autoHighlightInRead ? searchObj : null}
            scrollToVerse={scrollToVerse}
            ttsStatus={tts.status}
            onStartTTS={handleStartTTS}
            onPauseTTS={tts.pause}
            onStopTTS={tts.stop}
          />
        )}

        {mode === 'search' && (
          <SearchPane
            bible={bible}
            query={query}
            setQuery={setQuery}
            searchMode={searchMode}
            setSearchMode={setSearchMode}
            wholeWords={wholeWords}
            setWholeWords={setWholeWords}
            caseSensitive={caseSensitive}
            setCaseSensitive={setCaseSensitive}
            searchScope={searchScope}
            setSearchScope={setSearchScope}
            searchResults={searchResults}
            searchObj={searchObj}
            onJumpTo={jumpTo}
            showStats={showStats}
            setShowStats={setShowStats}
            bookFilter={bookFilter}
            setBookFilter={setBookFilter}
            chapFilter={chapFilter}
            setChapFilter={setChapFilter}
          />
        )}

        {mode === 'prophecy' && (
          <ProphecyPane prophecies={prophecies} loadError={prophecyError} />
        )}
      </main>

      {/* ── Controls overlay ─────────────────────────────────────────────── */}
      <ControlsOverlay
        open={showControls}
        onClose={() => setShowControls(false)}
        mode={mode}
        bible={bible}
        versions={versions}
        version={version}
        onLoadVersion={loadBibleVersion}
        versionError={versionError}
        bookIdx={bookIdx}
        chapterIdx={chapterIdx}
        vStart={vStart}
        vEnd={vEnd}
        setBookIdx={setBookIdx}
        setChapterIdx={setChapterIdx}
        setVStart={setVStart}
        setVEnd={setVEnd}
        searchQuery={query}
        setSearchQuery={setQuery}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        wholeWords={wholeWords}
        setWholeWords={setWholeWords}
        caseSensitive={caseSensitive}
        setCaseSensitive={setCaseSensitive}
        theme={theme}
        setTheme={setTheme}
        fontSize={fontSize}
        setFontSize={setFontSize}
        fontFamily={fontFamily}
        setFontFamily={setFontFamily}
        lineHeightPx={lineHeightPx}
        setLineHeightPx={setLineHeightPx}
        readerWidthPct={readerWidthPct}
        setReaderWidthPct={setReaderWidthPct}
        verseLayout={verseLayout}
        setVerseLayout={setVerseLayout}
        showNumbers={showNumbers}
        setShowNumbers={setShowNumbers}
        numberStyle={numberStyle}
        setNumberStyle={setNumberStyle}
        justifyText={justifyText}
        setJustifyText={setJustifyText}
        hoverHighlight={hoverHighlight}
        setHoverHighlight={setHoverHighlight}
        autoHighlightInRead={autoHighlightInRead}
        setAutoHighlightInRead={setAutoHighlightInRead}
      />
    </div>
  );
}
