'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Book } from '@/lib/types';

interface Props {
  books: Book[];
  currentBookIdx: number;
  onSelect: (idx: number) => void;
  onClose: () => void;
}

export default function BookPicker({ books, currentBookIdx, onSelect, onClose }: Props) {
  const [temp, setTemp] = useState(currentBookIdx);

  const apply = () => { onSelect(temp); onClose(); };

  // OT/NT split at Matthew (index 39 in canonical)
  const OT_NAMES = new Set([
    'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
    '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
    'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
    'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
    'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi',
  ]);

  const testament = (name: string) => (OT_NAMES.has(name) ? 'OT' : 'NT');

  return (
    <div className="absolute inset-0 z-50 bg-white dark:bg-slate-900 flex flex-col">
      <div className="sticky top-0 px-4 py-4 border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur flex items-center justify-between">
        <div className="text-sm font-semibold tracking-wide text-slate-700 dark:text-slate-200">Select Book</div>
        <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {(['OT', 'NT'] as const).map((t) => {
          const filtered = books
            .map((b, i) => ({ book: b, i }))
            .filter(({ book }) => testament(book.name) === t);
          if (!filtered.length) return null;
          return (
            <div key={t} className="mb-6">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-2">
                {t === 'OT' ? 'Old Testament' : 'New Testament'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-medium">
                {filtered.map(({ book, i }) => {
                  const active = temp === i;
                  return (
                    <button
                      key={i}
                      onClick={() => setTemp(i)}
                      aria-pressed={active}
                      className={cn(
                        'px-2.5 py-2 rounded-lg border text-left transition-colors',
                        active
                          ? 'bg-slate-900 text-white border-slate-900 dark:bg-indigo-600 dark:border-indigo-600'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                      )}
                    >
                      {book.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex gap-2">
        <button
          onClick={onClose}
          className="w-1/2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium px-4 py-2.5"
        >
          Cancel
        </button>
        <button
          onClick={apply}
          className="w-1/2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white text-sm font-medium px-4 py-2.5"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
