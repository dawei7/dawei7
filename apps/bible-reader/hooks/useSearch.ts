'use client';

import { useMemo } from 'react';
import type { Bible, SearchMode, SearchResults, SearchObject } from '@/lib/types';
import { buildSearchRegex, matchesSearch } from '@/lib/utils';

export const MAX_SEARCH_RESULTS = 5000;

export { buildSearchRegex };

export function useSearch(
  bible: Bible | null,
  query: string,
  searchMode: SearchMode,
  opts: {
    wholeWords: boolean;
    caseSensitive: boolean;
    searchScope?: 'all' | 'book';
    bookIdx?: number;
    chapFrom?: number;
    chapTo?: number;
  }
): { searchObj: SearchObject | null; searchResults: SearchResults } {
  const { wholeWords, caseSensitive, searchScope = 'all', bookIdx = 0, chapFrom = 1, chapTo = 0 } = opts;

  const searchObj = useMemo<SearchObject | null>(
    () => buildSearchRegex(query, searchMode, { wholeWords, caseSensitive }),
    [query, searchMode, wholeWords, caseSensitive]
  );

  const searchResults = useMemo<SearchResults>(() => {
    const empty: SearchResults = {
      rows: [],
      total: 0,
      perBook: {},
      perChap: {},
      exceeded: false,
    };
    if (!bible || !searchObj) return empty;

    const rows = [];
    let total = 0;
    const perBook: Record<string, number> = {};
    const perChap: Record<string, number> = {};
    let exceeded = false;

    const books = searchScope === 'book' ? [bible[bookIdx]] : bible;

    outer: for (const book of books) {
      if (!book) continue;
      const chapStart = chapFrom > 0 ? chapFrom - 1 : 0;
      const chapEnd = chapTo > 0 ? Math.min(chapTo - 1, book.chapters.length - 1) : book.chapters.length - 1;

      for (let ci = chapStart; ci <= chapEnd; ci++) {
        const chapter = book.chapters[ci];
        if (!chapter) continue;
        for (let vi = 0; vi < chapter.length; vi++) {
          const text = chapter[vi];
          const count = matchesSearch(text, searchObj);
          if (count > 0) {
            total += count;
            const bk = book.name;
            const ck = `${book.name} ${ci + 1}`;
            perBook[bk] = (perBook[bk] ?? 0) + count;
            perChap[ck] = (perChap[ck] ?? 0) + count;
            if (rows.length < MAX_SEARCH_RESULTS) {
              rows.push({
                bookName: book.name,
                bookAbbrev: book.abbrev ?? '',
                chapter: ci + 1,
                verse: vi + 1,
                text,
                count,
              });
            } else {
              exceeded = true;
              break outer;
            }
          }
        }
      }
    }

    return { rows, total, perBook, perChap, exceeded };
  }, [bible, searchObj, searchScope, bookIdx, chapFrom, chapTo]);

  return { searchObj, searchResults };
}
