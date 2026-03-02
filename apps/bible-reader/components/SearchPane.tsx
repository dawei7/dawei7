'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { MAX_SEARCH_RESULTS } from '@/hooks/useSearch';
import type { SearchResults, SearchObject, SearchMode, Bible } from '@/lib/types';
import HighlightText from './HighlightText';

// ── Compact horizontal progress-bar row used in the stats panel ───────────────
function HorizBar({
  name,
  count,
  max,
  active,
  accentClass,
  onSelect,
}: {
  name: string;
  count: number;
  max: number;
  active: boolean;
  accentClass: string;
  onSelect: () => void;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <button
      onClick={onSelect}
      title={`Filter: ${name} (${count})`}
      className={cn(
        'w-full text-left relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all overflow-hidden',
        active
          ? 'ring-2 ring-inset ring-indigo-500 dark:ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
      )}
    >
      {/* background fill bar */}
      {!active && (
        <span
          className={cn('absolute inset-y-0 left-0 rounded-lg opacity-[0.13] transition-all', accentClass)}
          style={{ width: `${pct}%` }}
        />
      )}
      <span className="relative z-10 flex-1 truncate">{name}</span>
      <span className={cn('relative z-10 tabular-nums shrink-0 font-medium', active ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500')}>
        {count}
      </span>
    </button>
  );
}

interface Props {
  bible: Bible | null;
  query: string;
  setQuery: (q: string) => void;
  searchMode: SearchMode;
  setSearchMode: (m: SearchMode) => void;
  wholeWords: boolean;
  setWholeWords: (v: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  searchScope: 'all' | 'book';
  setSearchScope: (s: 'all' | 'book') => void;
  searchResults: SearchResults;
  searchObj: SearchObject | null;
  onJumpTo: (bookName: string, chapter: number, verse: number) => void;
  showStats: boolean;
  setShowStats: (v: boolean) => void;
  bookFilter: string | null;
  setBookFilter: (v: string | null) => void;
  chapFilter: string | null;
  setChapFilter: (v: string | null) => void;
}

export default function SearchPane({
  bible,
  query,
  setQuery,
  searchMode,
  setSearchMode,
  wholeWords,
  setWholeWords,
  caseSensitive,
  setCaseSensitive,
  searchScope,
  setSearchScope,
  searchResults,
  searchObj,
  onJumpTo,
  showStats,
  setShowStats,
  bookFilter,
  setBookFilter,
  chapFilter,
  setChapFilter,
}: Props) {

  // Build a book-order lookup once from the loaded bible
  const bookOrder = useMemo(() => {
    const map: Record<string, number> = {};
    bible?.forEach((b, i) => { map[b.name] = i; });
    return map;
  }, [bible]);

  const topBooks = useMemo(
    () =>
      Object.entries(searchResults.perBook)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => (bookOrder[a.name] ?? 999) - (bookOrder[b.name] ?? 999)),
    [searchResults.perBook, bookOrder]
  );

  // Only show chapters that belong to the selected book, sorted numerically
  const topChapters = useMemo(() => {
    if (!bookFilter) return [];
    return Object.entries(searchResults.perChap)
      .filter(([name]) => name.startsWith(`${bookFilter} `))
      .map(([name, count]) => {
        const chNum = parseInt(name.slice(bookFilter.length + 1), 10);
        return { name, count, chNum };
      })
      .sort((a, b) => a.chNum - b.chNum);
  }, [searchResults.perChap, bookFilter]);

  const maxBook = topBooks.reduce((m, b) => Math.max(m, b.count), 1);
  const maxChap = topChapters.reduce((m, c) => Math.max(m, c.count), 1);

  // Apply filters to rows
  const displayRows = useMemo(() => {
    let rows = searchResults.rows;
    if (bookFilter) rows = rows.filter((r) => r.bookName === bookFilter);
    if (chapFilter) rows = rows.filter((r) => `${r.bookName} ${r.chapter}` === chapFilter);
    return rows;
  }, [searchResults.rows, bookFilter, chapFilter]);

  const activeFilters = [
    bookFilter && { label: bookFilter, clear: () => { setBookFilter(null); setChapFilter(null); } },
    chapFilter && { label: chapFilter, clear: () => setChapFilter(null) },
  ].filter(Boolean) as { label: string; clear: () => void }[];

  const hasResults = searchResults.rows.length > 0;

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900" style={{ overscrollBehavior: 'contain' }}>

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-700 px-4 py-3 space-y-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the Bible…"
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 text-xs font-medium">
            {(['all', 'any', 'phrase'] as SearchMode[]).map((m) => (
              <button key={m} onClick={() => setSearchMode(m)}
                className={cn('px-2.5 py-1.5 transition-colors',
                  searchMode === m ? 'bg-slate-900 dark:bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50')}>
                {m === 'all' ? 'All words' : m === 'any' ? 'Any word' : 'Phrase'}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 text-xs font-medium">
            {(['all', 'book'] as const).map((s) => (
              <button key={s} onClick={() => setSearchScope(s)}
                className={cn('px-2.5 py-1.5 transition-colors',
                  searchScope === s ? 'bg-slate-900 dark:bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50')}>
                {s === 'all' ? 'All books' : 'Current book'}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.target.checked)} className="accent-indigo-600" />
            Whole words
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} className="accent-indigo-600" />
            Case
          </label>
        </div>

        {/* Result count + stats toggle */}
        {query && (
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {searchResults.exceeded
                ? `>${MAX_SEARCH_RESULTS} (first ${MAX_SEARCH_RESULTS})`
                : `${displayRows.length}${bookFilter || chapFilter ? ` / ${searchResults.rows.length}` : ''} result${displayRows.length !== 1 ? 's' : ''}`}
              {searchResults.total > 0 && !searchResults.exceeded && ` · ${searchResults.total} hits`}
            </span>
            {hasResults && (
              <button onClick={() => setShowStats(!showStats)}
                className={cn('px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors',
                  showStats
                    ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600'
                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-400')}>
                {showStats ? '▲ Stats' : '▼ Stats'}
              </button>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeFilters.map(({ label, clear }) => (
              <span key={label}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-medium">
                {label}
                <button onClick={clear} className="hover:bg-indigo-500 rounded-full w-4 h-4 flex items-center justify-center text-indigo-200 hover:text-white transition-colors">✕</button>
              </span>
            ))}
            <button onClick={() => { setBookFilter(null); setChapFilter(null); }}
              className="text-[11px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline">
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pb-8">

        {/* ── Stats panel ──────────────────────────────────────────────────── */}
        <AnimatePresence>
          {showStats && hasResults && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="pt-4 pb-3 border-b border-slate-200 dark:border-slate-700">
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3 uppercase tracking-wide font-semibold">
                  Click a bar to filter results
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {/* Books column */}
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-sm bg-indigo-500" /> Books
                    </div>
                    <div className="space-y-0.5">
                      {(bookFilter ? topBooks.filter(b => b.name === bookFilter) : topBooks).map(({ name, count }) => (
                        <HorizBar key={name} name={name} count={count} max={maxBook}
                          active={bookFilter === name} accentClass="bg-indigo-500"
                          onSelect={() => {
                            const next = bookFilter === name ? null : name;
                            setBookFilter(next);
                            setChapFilter(null);
                          }} />
                      ))}
                    </div>
                  </div>

                  {/* Chapters column — only populated when a book is selected */}
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-sm bg-violet-500" /> Chapters
                      {bookFilter && <span className="text-slate-300 dark:text-slate-600 font-normal normal-case tracking-normal truncate">({bookFilter})</span>}
                    </div>
                    {!bookFilter ? (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 italic px-1 pt-1">Select a book first</p>
                    ) : (
                      <div className="space-y-0.5">
                        {(chapFilter ? topChapters.filter(c => c.name === chapFilter) : topChapters).map(({ name, count, chNum }) => (
                          <HorizBar key={name} name={`Chapter ${chNum}`} count={count} max={maxChap}
                            active={chapFilter === name} accentClass="bg-violet-500"
                            onSelect={() => { setChapFilter(chapFilter === name ? null : name); }} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Results ───────────────────────────────────────────────────────── */}
        {!query ? (
          <div className="mt-12 text-center text-slate-400 dark:text-slate-600">
            <div className="text-3xl mb-2">🔍</div>
            <div className="text-sm">Type to search the Bible</div>
          </div>
        ) : searchResults.rows.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">No matches found.</p>
        ) : displayRows.length === 0 ? (
          <div className="mt-6 text-center space-y-2">
            <p className="text-sm text-slate-500 dark:text-slate-400">No results in this filter.</p>
            <button onClick={() => { setBookFilter(null); setChapFilter(null); }}
              className="text-xs text-indigo-600 dark:text-indigo-400 underline">Clear filter</button>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {searchResults.exceeded && !bookFilter && !chapFilter && (
              <div className="pb-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 mb-3">
                Too many results — showing first {MAX_SEARCH_RESULTS}. Narrow your search.
              </div>
            )}
            {displayRows.map((row, idx) => (
              <motion.div key={`${row.bookName}-${row.chapter}-${row.verse}`}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 0.12, delay: Math.min(idx * 0.015, 0.4) }}
                className="py-3">
                <div className="flex items-center gap-2 mb-1">
                  <button onClick={() => onJumpTo(row.bookName, row.chapter, row.verse)}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                    {row.bookName} {row.chapter}:{row.verse}
                  </button>
                  {row.count > 1 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-semibold tabular-nums">
                      {row.count}×
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-300 leading-6">
                  <HighlightText text={row.text} searchObj={searchObj} />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
