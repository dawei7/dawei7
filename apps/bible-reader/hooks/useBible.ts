'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Bible, BibleVersionMeta, BibleVersionGroup, ReadingPosition } from '@/lib/types';
import { coerceBible, normalizeBible } from '@/lib/utils';

const FETCH_TIMEOUT_MS = 10_000;

// Tiny Genesis fallback so app never shows empty state without data
export const SAMPLE_BIBLE: Bible = [
  {
    name: 'Genesis',
    abbrev: 'Gen',
    chapters: [
      [
        'In the beginning God created the heavens and the earth.',
        'The earth was formless and empty, and darkness covered the deep waters.',
        'Then God said, "Let there be light," and there was light.',
      ],
    ],
  },
];

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
  } finally {
    clearTimeout(id);
  }
}

function getStoredVersion(): string | null {
  try { return localStorage.getItem('br_version'); } catch { return null; }
}
function setStoredVersion(v: string): void {
  try { localStorage.setItem('br_version', v); } catch { /* noop */ }
}
function getStoredPos(abbr: string): ReadingPosition | null {
  try {
    const raw = localStorage.getItem(`br_pos_${abbr}`);
    if (raw) return JSON.parse(raw) as ReadingPosition;
  } catch { /* noop */ }
  return null;
}
export function setStoredPos(abbr: string, pos: ReadingPosition): void {
  try { localStorage.setItem(`br_pos_${abbr}`, JSON.stringify(pos)); } catch { /* noop */ }
}

export function useBible() {
  const [bible, setBible] = useState<Bible | null>(null);
  const [version, setVersion] = useState<string>('');
  const [versions, setVersions] = useState<BibleVersionMeta[]>([]);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [bookIdx, setBookIdx] = useState(0);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [vStart, setVStart] = useState(1);
  const [vEnd, setVEnd] = useState(0);

  const cacheRef = useRef<Record<string, Bible>>({});
  const loadTokenRef = useRef(0);

  const applyPosition = useCallback(
    (data: Bible, pos: ReadingPosition | null) => {
      if (!pos) return;
      const bMax = Math.max(0, data.length - 1);
      const bIdx = Math.min(Math.max(0, pos.bookIdx), bMax);
      const cMax = Math.max(0, (data[bIdx]?.chapters.length ?? 1) - 1);
      const cIdx = Math.min(Math.max(0, pos.chapterIdx), cMax);
      const vCount = data[bIdx]?.chapters[cIdx]?.length ?? 0;
      const vsStart = Math.max(1, pos.vStart ?? 1);
      const vsEnd =
        pos.vEnd === 0 ? 0 : Math.min(Math.max(1, pos.vEnd ?? 0), vCount);
      setBookIdx(bIdx);
      setChapterIdx(cIdx);
      setVStart(vsStart);
      setVEnd(vsEnd);
    },
    []
  );

  const loadBibleVersion = useCallback(
    async (abbr: string): Promise<boolean> => {
      if (!abbr) return false;
      setLoadingVersion(true);
      setVersionError(null);
      const myToken = ++loadTokenRef.current;

      // Cache hit
      if (cacheRef.current[abbr]) {
        const data = cacheRef.current[abbr];
        setBible(data);
        setVersion(abbr);
        setStoredVersion(abbr);
        applyPosition(data, getStoredPos(abbr));
        setLoadingVersion(false);
        return true;
      }

      try {
        const base = '/';
        const res = await fetchWithTimeout(
          `${base}bibles/${abbr}.json`,
          FETCH_TIMEOUT_MS
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const data = coerceBible(raw);
        normalizeBible(data);
        if (loadTokenRef.current !== myToken) return false;
        if (data.length >= 3) cacheRef.current[abbr] = data;
        setBible(data);
        setVersion(abbr);
        setStoredVersion(abbr);
        applyPosition(data, getStoredPos(abbr));
        setLoadingVersion(false);
        return true;
      } catch (e) {
        if (loadTokenRef.current !== myToken) return false;
        setVersionError(String((e as Error)?.message || e));
        setLoadingVersion(false);
        return false;
      }
    },
    [applyPosition]
  );

  // Load versions index on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithTimeout('/bibles/index.json', FETCH_TIMEOUT_MS);
        if (!res.ok) throw new Error('index fetch');
        const idx: BibleVersionGroup[] = await res.json();
        if (cancelled) return;

        const flat: BibleVersionMeta[] = idx.flatMap((g) =>
          g.versions.map((v) => ({
            language: g.language,
            name: v.name,
            abbreviation: v.abbreviation,
          }))
        );

        // Priority: de_schlachter, en_kjv, then rest alphabetically
        const priority = ['de_schlachter', 'en_kjv'];
        const picked = priority
          .map((ab) => flat.find((v) => v.abbreviation === ab))
          .filter((v): v is BibleVersionMeta => Boolean(v));
        const rest = flat
          .filter((v) => !priority.includes(v.abbreviation))
          .sort((a, b) => a.name.localeCompare(b.name));
        const ordered = [...picked, ...rest];
        setVersions(ordered);

        if (ordered.length) {
          const stored = getStoredVersion();
          const storedVersion = stored && ordered.find((v) => v.abbreviation === stored);
          const preferred = storedVersion || ordered[0];
          if (preferred) {
            const ok = await loadBibleVersion(preferred.abbreviation);
            if (!ok && !storedVersion && ordered[1]) {
              await loadBibleVersion(ordered[1].abbreviation);
            }
          }
        }
      } catch {
        if (!cancelled) {
          setBible(SAMPLE_BIBLE);
          setVersion('sample');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadBibleVersion]);

  return {
    bible,
    version,
    versions,
    loadingVersion,
    versionError,
    bookIdx, setBookIdx,
    chapterIdx, setChapterIdx,
    vStart, setVStart,
    vEnd, setVEnd,
    loadBibleVersion,
  };
}
