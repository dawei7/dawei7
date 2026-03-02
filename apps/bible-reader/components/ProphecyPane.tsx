'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { buildSearchRegex } from '@/hooks/useSearch';
import type { Prophecy, SearchMode, ProphecySummaryLine } from '@/lib/types';

function summaryFor(p: Prophecy, lang: 'en' | 'de'): ProphecySummaryLine {
  const loc = p.summary[lang];
  return {
    prophecy: loc?.prophecy ?? p.summary.prophecy ?? '',
    fulfillment: loc?.fulfillment ?? p.summary.fulfillment ?? '',
  };
}
import HighlightText from './HighlightText';

interface Props {
  prophecies: Prophecy[];
  loadError: string | null;
}

export default function ProphecyPane({ prophecies, loadError }: Props) {
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('all');
  const [lang, setLang] = useState<'en' | 'de'>('en');
  const [expanded, setExpanded] = useState<string | number | null>(null);

  const searchObj = useMemo(
    () => buildSearchRegex(search, searchMode, { caseSensitive: false }),
    [search, searchMode]
  );

  const filtered = useMemo(() => {
    if (!search || !searchObj) return prophecies;
    return prophecies.filter((p) => {
      const s = summaryFor(p, lang);
      const haystack = [
        s.prophecy,
        s.fulfillment,
        p.prophecyRef,
        p.fulfillment?.biblicalRef ?? '',
        p.notes?.[lang] ?? '',
      ].join(' ');
      return searchObj.regexes.every((r) => { r.lastIndex = 0; return r.test(haystack); });
    });
  }, [prophecies, search, searchObj, lang]);

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900" style={{ overscrollBehavior: 'contain' }}>
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-700 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            Prophecies &amp; Fulfillments
          </h2>
          <div className="flex gap-1">
            {(['en', 'de'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium uppercase',
                  lang === l
                    ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prophecies…"
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex gap-1 text-xs">
          {(['all', 'any', 'phrase'] as SearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setSearchMode(m)}
              className={cn(
                'px-2.5 py-1 rounded-lg border transition-colors',
                searchMode === m
                  ? 'bg-slate-900 dark:bg-indigo-600 text-white border-slate-900 dark:border-indigo-600'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
              )}
            >
              {m === 'all' ? 'All' : m === 'any' ? 'Any' : 'Phrase'}
            </button>
          ))}
          <span className="ml-auto self-center text-slate-400 dark:text-slate-500 text-[11px]">
            {filtered.length}/{prophecies.length}
          </span>
        </div>
      </div>

      <div className="px-4 pb-8">
        {loadError && (
          <div className="mt-4 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-700 dark:text-amber-400">
            Could not load prophecies: {loadError}
          </div>
        )}

        {!loadError && prophecies.length === 0 && (
          <div className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Add a <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">public/prophecies.json</code> file to enable this feature.
          </div>
        )}

        {filtered.length === 0 && search && (
          <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">No matches.</p>
        )}

        <ul className="mt-4 space-y-3">
          {filtered.map((p) => {
            const isOpen = expanded === p.id;
            const s = summaryFor(p, lang);
            const title = s.prophecy;
            const summary = s.fulfillment;
            return (
              <motion.li
                key={p.id}
                layout
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                  className="w-full text-left px-4 py-3 flex items-start justify-between gap-2"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      <HighlightText text={title} searchObj={searchObj} />
                    </div>
                    <div className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-400">
                      {p.prophecyRef}
                      {p.fulfillment?.biblicalRef && (
                        <span className="text-slate-400 dark:text-slate-500"> → {p.fulfillment.biblicalRef}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-slate-400 shrink-0 mt-0.5 text-xs">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="px-4 pb-4 space-y-3"
                  >
                    {summary && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-5">
                        <HighlightText text={summary} searchObj={searchObj} />
                      </p>
                    )}
                    {p.fulfillment?.biblicalRef && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-1">Biblical References</div>
                        <p className="text-xs text-indigo-600 dark:text-indigo-400 leading-5">
                          {p.fulfillment.biblicalRef}
                        </p>
                      </div>
                    )}
                    {(() => { const note = p.notes?.[lang] || p.notes?.en; return note ? (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-1">Notes</div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-5">{note}</p>
                      </div>
                    ) : null; })()}
                    {p.category && (
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">
                        {p.category.en}{p.category.de && p.category.de !== p.category.en ? ` · ${p.category.de}` : ''}
                      </div>
                    )}
                    {p.tags && p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.tags.map((tag) => (
                          <span key={tag} className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.li>
            );
          })}
        </ul>

        {prophecies.length > 0 && (
          <p className="mt-6 text-[10px] text-slate-400 dark:text-slate-500 text-center">
            Data from <code>public/prophecies.json</code> · {prophecies.length} entries
          </p>
        )}
      </div>
    </div>
  );
}
