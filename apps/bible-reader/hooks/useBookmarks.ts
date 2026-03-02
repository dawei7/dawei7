'use client';

import { useState, useCallback } from 'react';
import type { Bookmark } from '@/lib/types';

const STORAGE_KEY = 'br_bookmarks';

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Bookmark[];
  } catch { /* noop */ }
  return [];
}

function saveBookmarks(marks: Bookmark[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(marks)); } catch { /* noop */ }
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    if (typeof window === 'undefined') return [];
    return loadBookmarks();
  });

  const addBookmark = useCallback((bm: Omit<Bookmark, 'id' | 'createdAt'>) => {
    const newBm: Bookmark = {
      ...bm,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
    };
    setBookmarks((prev) => {
      const next = [newBm, ...prev];
      saveBookmarks(next);
      return next;
    });
    return newBm;
  }, []);

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      saveBookmarks(next);
      return next;
    });
  }, []);

  const isBookmarked = useCallback(
    (bookIdx: number, chapterIdx: number, version: string) =>
      bookmarks.some(
        (b) => b.bookIdx === bookIdx && b.chapterIdx === chapterIdx && b.version === version
      ),
    [bookmarks]
  );

  return { bookmarks, addBookmark, removeBookmark, isBookmarked };
}
