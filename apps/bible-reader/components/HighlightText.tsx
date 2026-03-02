'use client';

import { Fragment } from 'react';
import type { SearchObject } from '@/lib/types';

interface Props {
  text: string;
  searchObj: SearchObject | null;
}

export default function HighlightText({ text, searchObj }: Props) {
  if (!searchObj || !searchObj.query) return <>{text}</>;

  // Build a combined regex from all patterns
  const combined = new RegExp(
    searchObj.regexes.map((r) => `(${r.source})`).join('|'),
    searchObj.regexes[0]?.flags.includes('i') ? 'gi' : 'g'
  );

  const parts: { text: string; highlight: boolean }[] = [];
  let last = 0;
  combined.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = combined.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), highlight: false });
    parts.push({ text: m[0], highlight: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) { combined.lastIndex++; } // guard infinite loop
  }
  if (last < text.length) parts.push({ text: text.slice(last), highlight: false });

  return (
    <>
      {parts.map((p, i) =>
        p.highlight ? (
          <mark
            key={i}
            className="bg-amber-200 dark:bg-amber-700/60 text-slate-900 dark:text-amber-100 rounded-sm px-0.5"
          >
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}
