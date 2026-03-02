'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { BibleVersionMeta } from '@/lib/types';

interface Props {
  versions: BibleVersionMeta[];
  currentVersion: string;
  onSelect: (abbr: string) => void;
  onClose: () => void;
}

export default function VersionPicker({ versions, currentVersion, onSelect, onClose }: Props) {
  const [temp, setTemp] = useState(currentVersion);

  const byLanguage = useMemo(() => {
    const map = new Map<string, BibleVersionMeta[]>();
    for (const v of versions) {
      if (!map.has(v.language)) map.set(v.language, []);
      map.get(v.language)!.push(v);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [versions]);

  const apply = () => { onSelect(temp); onClose(); };

  return (
    <div className="absolute inset-0 z-50 bg-white dark:bg-slate-900 flex flex-col">
      <div className="sticky top-0 px-4 py-4 border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur flex items-center justify-between">
        <div className="text-sm font-semibold tracking-wide text-slate-700 dark:text-slate-200">Select Version</div>
        <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {byLanguage.map(([lang, list]) => (
          <div key={lang} className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
              {lang}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {list.map((v) => {
                const active = temp === v.abbreviation;
                return (
                  <button
                    key={v.abbreviation}
                    onClick={() => setTemp(v.abbreviation)}
                    aria-pressed={active}
                    className={cn(
                      'px-2 py-2 rounded-lg border text-[11px] font-medium text-left transition-colors',
                      active
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-indigo-600 dark:border-indigo-600'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                    )}
                  >
                    <div className="truncate">{v.name}</div>
                    <div className="mt-0.5 text-[10px] opacity-60">{v.abbreviation}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
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
