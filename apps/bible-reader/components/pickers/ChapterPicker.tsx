'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  chapterCount: number;
  currentChapterIdx: number;
  onSelect: (idx: number) => void;
  onClose: () => void;
}

export default function ChapterPicker({ chapterCount, currentChapterIdx, onSelect, onClose }: Props) {
  const [temp, setTemp] = useState(currentChapterIdx);

  const apply = () => { onSelect(temp); onClose(); };

  return (
    <div className="absolute inset-0 z-50 bg-white dark:bg-slate-900 flex flex-col">
      <div className="sticky top-0 px-4 py-4 border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur flex items-center justify-between">
        <div className="text-sm font-semibold tracking-wide text-slate-700 dark:text-slate-200">Select Chapter</div>
        <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2 text-[11px] font-medium">
          {Array.from({ length: chapterCount }, (_, i) => {
            const active = temp === i;
            return (
              <button
                key={i}
                onClick={() => setTemp(i)}
                aria-pressed={active}
                className={cn(
                  'h-9 rounded-lg border flex items-center justify-center transition-colors',
                  active
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-indigo-600 dark:border-indigo-600'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
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
