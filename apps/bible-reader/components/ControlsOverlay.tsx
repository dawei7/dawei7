'use client';

import { useState } from 'react';
import { cn, clamp } from '@/lib/utils';
import type {
  Bible, BibleVersionMeta, AppMode, Theme, VerseLayout, NumberStyle, FontFamily, SearchMode,
} from '@/lib/types';
import VersionPicker from './pickers/VersionPicker';
import BookPicker from './pickers/BookPicker';
import ChapterPicker from './pickers/ChapterPicker';

interface Props {
  open: boolean;
  onClose: () => void;
  mode: AppMode;
  // Bible / version
  bible: Bible | null;
  versions: BibleVersionMeta[];
  version: string;
  onLoadVersion: (abbr: string) => void;
  versionError: string | null;
  // Read position
  bookIdx: number;
  chapterIdx: number;
  vStart: number;
  vEnd: number;
  setBookIdx: (i: number) => void;
  setChapterIdx: (i: number) => void;
  setVStart: (v: number) => void;
  setVEnd: (v: number) => void;
  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchMode: SearchMode;
  setSearchMode: (m: SearchMode) => void;
  wholeWords: boolean;
  setWholeWords: (v: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  // Settings (typography / layout)
  theme: Theme;
  setTheme: (t: Theme) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  fontFamily: FontFamily;
  setFontFamily: (f: FontFamily) => void;
  lineHeightPx: number;
  setLineHeightPx: (n: number) => void;
  readerWidthPct: number;
  setReaderWidthPct: (n: number) => void;
  verseLayout: VerseLayout;
  setVerseLayout: (l: VerseLayout) => void;
  showNumbers: boolean;
  setShowNumbers: (v: boolean) => void;
  numberStyle: NumberStyle;
  setNumberStyle: (s: NumberStyle) => void;
  justifyText: boolean;
  setJustifyText: (v: boolean) => void;
  hoverHighlight: boolean;
  setHoverHighlight: (v: boolean) => void;
  autoHighlightInRead: boolean;
  setAutoHighlightInRead: (v: boolean) => void;
}

type Tab = 'controls' | 'settings';

export default function ControlsOverlay(props: Props) {
  const {
    open, onClose, mode,
    bible, versions, version, onLoadVersion, versionError,
    bookIdx, chapterIdx, vStart, vEnd,
    setBookIdx, setChapterIdx, setVStart, setVEnd,
    searchQuery, setSearchQuery, searchMode, setSearchMode,
    wholeWords, setWholeWords, caseSensitive, setCaseSensitive,
    theme, setTheme, fontSize, setFontSize, fontFamily, setFontFamily,
    lineHeightPx, setLineHeightPx, readerWidthPct, setReaderWidthPct,
    verseLayout, setVerseLayout, showNumbers, setShowNumbers,
    numberStyle, setNumberStyle, justifyText, setJustifyText,
    hoverHighlight, setHoverHighlight, autoHighlightInRead, setAutoHighlightInRead,
  } = props;

  const [tab, setTab] = useState<Tab>('controls');
  const [showVersionPicker, setShowVersionPicker] = useState(false);
  const [showBookPicker, setShowBookPicker] = useState(false);
  const [showChapterPicker, setShowChapterPicker] = useState(false);

  const book = bible?.[bookIdx];
  const chapterCount = book?.chapters.length ?? 0;
  const verseCount = book?.chapters[chapterIdx]?.length ?? 0;
  const currentVersionObj = versions.find((v) => v.abbreviation === version);

  // Temp state for apply-on-confirm
  const [tempBookIdx, setTempBookIdx] = useState(bookIdx);
  const [tempChapterIdx, setTempChapterIdx] = useState(chapterIdx);

  const applyRead = () => {
    setBookIdx(tempBookIdx);
    setChapterIdx(tempChapterIdx);
    setVStart(1);
    setVEnd(0);
    onClose();
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-transform duration-200',
        open ? 'translate-y-0 pointer-events-auto' : 'translate-y-full pointer-events-none'
      )}
      aria-hidden={!open}
    >
      <div className="w-full h-full bg-white dark:bg-slate-900 flex flex-col relative">
        {/* Header */}
        <div className="sticky top-0 z-10 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold tracking-wide text-slate-700 dark:text-slate-200">
              {mode === 'read' ? 'Reading Controls' : 'Search Controls'}
            </div>
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
          {/* Tabs */}
          <div className="flex gap-1">
            {(['controls', 'settings'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                  tab === t
                    ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {tab === 'controls' ? (
            mode === 'read' ? (
              <ReadControls
                bible={bible}
                bookIdx={tempBookIdx}
                chapterIdx={tempChapterIdx}
                vStart={vStart}
                vEnd={vEnd}
                verseCount={verseCount}
                setVStart={setVStart}
                setVEnd={setVEnd}
                currentVersionObj={currentVersionObj}
                versionError={versionError}
                openVersionPicker={() => setShowVersionPicker(true)}
                openBookPicker={() => { setTempBookIdx(bookIdx); setShowBookPicker(true); }}
                openChapterPicker={() => { setTempChapterIdx(chapterIdx); setShowChapterPicker(true); }}
              />
            ) : (
              <SearchControls
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                searchMode={searchMode}
                setSearchMode={setSearchMode}
                wholeWords={wholeWords}
                setWholeWords={setWholeWords}
                caseSensitive={caseSensitive}
                setCaseSensitive={setCaseSensitive}
              />
            )
          ) : (
            <SettingsContent
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
          )}
        </div>

        {/* Apply button for read mode */}
        {tab === 'controls' && mode === 'read' && (
          <div className="px-4 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button
              onClick={applyRead}
              className="w-full rounded-xl bg-slate-900 dark:bg-indigo-600 text-white text-sm font-medium px-4 py-2.5"
            >
              Apply
            </button>
          </div>
        )}

        {/* Nested pickers */}
        {showVersionPicker && (
          <VersionPicker
            versions={versions}
            currentVersion={version}
            onSelect={(abbr) => { onLoadVersion(abbr); }}
            onClose={() => setShowVersionPicker(false)}
          />
        )}
        {showBookPicker && bible && (
          <BookPicker
            books={bible}
            currentBookIdx={tempBookIdx}
            onSelect={(i) => setTempBookIdx(i)}
            onClose={() => setShowBookPicker(false)}
          />
        )}
        {showChapterPicker && (
          <ChapterPicker
            chapterCount={bible?.[tempBookIdx]?.chapters.length ?? 0}
            currentChapterIdx={tempChapterIdx}
            onSelect={(i) => setTempChapterIdx(i)}
            onClose={() => setShowChapterPicker(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ReadControls({
  bible, bookIdx, chapterIdx, vStart, vEnd, verseCount,
  setVStart, setVEnd, currentVersionObj, versionError,
  openVersionPicker, openBookPicker, openChapterPicker,
}: {
  bible: Bible | null;
  bookIdx: number;
  chapterIdx: number;
  vStart: number;
  vEnd: number;
  verseCount: number;
  setVStart: (v: number) => void;
  setVEnd: (v: number) => void;
  currentVersionObj: BibleVersionMeta | undefined;
  versionError: string | null;
  openVersionPicker: () => void;
  openBookPicker: () => void;
  openChapterPicker: () => void;
}) {
  const book = bible?.[bookIdx];
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Bible Version</label>
        <button
          onClick={openVersionPicker}
          className="w-full text-left px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm flex items-center justify-between"
        >
          <span className="font-medium text-slate-700 dark:text-slate-200 truncate">
            {currentVersionObj?.name ?? '—'}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 ml-2">Change ▸</span>
        </button>
        {versionError && (
          <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{versionError}</div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Book</label>
        <button
          onClick={openBookPicker}
          className="w-full text-left px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm flex items-center justify-between"
        >
          <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{book?.name ?? '—'}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 ml-2">Change ▸</span>
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Chapter</label>
        <button
          onClick={openChapterPicker}
          className="w-full text-left px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm flex items-center justify-between"
        >
          <span className="font-medium text-slate-700 dark:text-slate-200">{chapterIdx + 1}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 ml-2">Change ▸</span>
        </button>
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Verses in chapter: {verseCount}
        </div>
      </div>

      {/* Verse range */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Verse range</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={verseCount}
            value={vStart}
            onChange={(e) => setVStart(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-center"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="number"
            min={0}
            max={verseCount}
            value={vEnd}
            onChange={(e) => setVEnd(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-16 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-center"
          />
          <span className="text-xs text-slate-400 dark:text-slate-500">(0 = end)</span>
        </div>
      </div>
    </div>
  );
}

function SearchControls({
  searchQuery, setSearchQuery, searchMode, setSearchMode,
  wholeWords, setWholeWords, caseSensitive, setCaseSensitive,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchMode: SearchMode;
  setSearchMode: (m: SearchMode) => void;
  wholeWords: boolean;
  setWholeWords: (v: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Search query</label>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="e.g. light, Spirit of God, …"
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Search mode</label>
        <div className="grid grid-cols-3 gap-2 text-xs font-medium">
          {(['all', 'any', 'phrase'] as SearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setSearchMode(m)}
              className={cn(
                'px-2.5 py-2 rounded-lg border transition-colors',
                searchMode === m
                  ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
              )}
            >
              {m === 'all' ? 'All words' : m === 'any' ? 'Any word' : 'Phrase'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.target.checked)} />
          Whole words only
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          Case sensitive
        </label>
      </div>
    </div>
  );
}

function SettingsContent({
  theme, setTheme, fontSize, setFontSize,
  fontFamily, setFontFamily, lineHeightPx, setLineHeightPx,
  readerWidthPct, setReaderWidthPct, verseLayout, setVerseLayout,
  showNumbers, setShowNumbers, numberStyle, setNumberStyle,
  justifyText, setJustifyText, hoverHighlight, setHoverHighlight,
  autoHighlightInRead, setAutoHighlightInRead,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  fontFamily: FontFamily;
  setFontFamily: (f: FontFamily) => void;
  lineHeightPx: number;
  setLineHeightPx: (n: number) => void;
  readerWidthPct: number;
  setReaderWidthPct: (n: number) => void;
  verseLayout: VerseLayout;
  setVerseLayout: (l: VerseLayout) => void;
  showNumbers: boolean;
  setShowNumbers: (v: boolean) => void;
  numberStyle: NumberStyle;
  setNumberStyle: (s: NumberStyle) => void;
  justifyText: boolean;
  setJustifyText: (v: boolean) => void;
  hoverHighlight: boolean;
  setHoverHighlight: (v: boolean) => void;
  autoHighlightInRead: boolean;
  setAutoHighlightInRead: (v: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Theme */}
      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Theme</div>
        <div className="flex gap-2">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors',
                theme === t
                  ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {/* Typography */}
      <section className="space-y-3">
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Typography</div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Font size: {fontSize}px
          </label>
          <input
            type="range" min={10} max={28} step={1}
            value={fontSize}
            onChange={(e) => setFontSize(clamp(parseInt(e.target.value), 10, 28))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Font family</label>
          <div className="flex gap-2">
            {(['sans', 'serif'] as FontFamily[]).map((f) => (
              <button
                key={f}
                onClick={() => setFontFamily(f)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-xs font-medium capitalize',
                  fontFamily === f
                    ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Line height: {lineHeightPx}px
          </label>
          <input
            type="range" min={18} max={56} step={2}
            value={lineHeightPx}
            onChange={(e) => setLineHeightPx(clamp(parseInt(e.target.value), 18, 56))}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={justifyText} onChange={(e) => setJustifyText(e.target.checked)} />
            Justify text
          </label>
        </div>
      </section>

      {/* Layout */}
      <section className="space-y-3">
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Layout</div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Reader width: {readerWidthPct}%
          </label>
          <input
            type="range" min={30} max={100} step={5}
            value={readerWidthPct}
            onChange={(e) => setReaderWidthPct(clamp(parseInt(e.target.value), 30, 100))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Verse layout</label>
          <div className="flex gap-2">
            {(['blocks', 'continuous'] as VerseLayout[]).map((l) => (
              <button
                key={l}
                onClick={() => setVerseLayout(l)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-xs font-medium capitalize',
                  verseLayout === l
                    ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} />
            Show verse numbers
          </label>
          {showNumbers && (
            <div className="ml-5 flex gap-2">
              {(['inline', 'superscript'] as NumberStyle[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setNumberStyle(s)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg border text-xs font-medium capitalize',
                    numberStyle === s
                      ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={hoverHighlight} onChange={(e) => setHoverHighlight(e.target.checked)} />
            Highlight verse on hover
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={autoHighlightInRead} onChange={(e) => setAutoHighlightInRead(e.target.checked)} />
            Highlight search matches while reading
          </label>
        </div>
      </section>
    </div>
  );
}
