'use client';

import { useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn, clamp } from '@/lib/utils';
import { setStoredPos } from '@/hooks/useBible';
import type { Bible, VerseLayout, NumberStyle, SearchObject } from '@/lib/types';
import type { TtsStatus } from '@/hooks/useTTS';
import HighlightText from './HighlightText';

interface Props {
  bible: Bible;
  version: string;
  bookIdx: number;
  chapterIdx: number;
  vStart: number;
  vEnd: number;
  setBookIdx: (i: number) => void;
  setChapterIdx: (i: number) => void;
  setVStart: (v: number) => void;
  setVEnd: (v: number) => void;
  // settings
  fontSize: number;
  fontFamily: 'sans' | 'serif';
  lineHeightPx: number;
  readerWidthPct: number;
  verseLayout: VerseLayout;
  showNumbers: boolean;
  numberStyle: NumberStyle;
  justifyText: boolean;
  hoverHighlight: boolean;
  autoHighlightSearchInRead: boolean;
  searchObj: SearchObject | null;
  scrollToVerse?: number;
  // TTS
  ttsStatus: TtsStatus;
  onStartTTS: (fromVerseIdx: number) => void;
  onPauseTTS: () => void;
  onStopTTS: () => void;
}

export default function ReadPane({
  bible,
  version,
  bookIdx,
  chapterIdx,
  vStart,
  vEnd,
  setBookIdx,
  setChapterIdx,
  setVStart,
  setVEnd,
  fontSize,
  fontFamily,
  lineHeightPx,
  readerWidthPct,
  verseLayout,
  showNumbers,
  numberStyle,
  justifyText,
  hoverHighlight,
  autoHighlightSearchInRead,
  searchObj,
  scrollToVerse,
  ttsStatus,
  onStartTTS,
  onPauseTTS,
  onStopTTS,
}: Props) {
  const book = bible[bookIdx];
  const chapterCount = book?.chapters.length ?? 0;
  const chapter = book?.chapters[chapterIdx] ?? [];
  const verseCount = chapter.length;
  const vEndEff = vEnd === 0 ? verseCount : clamp(vEnd, 1, verseCount);
  const vStartEff = clamp(vStart, 1, vEndEff);
  const verses = chapter.slice(vStartEff - 1, vEndEff);

  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to a specific verse when jumping from search
  useEffect(() => {
    if (!scrollToVerse || scrollToVerse <= 1) return;
    // Wait one frame for the DOM to paint
    const id = requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-verse="${scrollToVerse}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [scrollToVerse, bookIdx, chapterIdx]);

  // Persist position
  useEffect(() => {
    if (version) {
      setStoredPos(version, { bookIdx, chapterIdx, vStart: vStartEff, vEnd });
    }
  }, [version, bookIdx, chapterIdx, vStartEff, vEnd]);

  const prevChapter = useCallback(() => {
    if (chapterIdx > 0) {
      setChapterIdx(chapterIdx - 1);
      setVStart(1); setVEnd(0);
    } else if (bookIdx > 0) {
      const newBook = bookIdx - 1;
      setBookIdx(newBook);
      const newChap = (bible[newBook]?.chapters.length ?? 1) - 1;
      setChapterIdx(newChap);
      setVStart(1); setVEnd(0);
    }
    containerRef.current?.scrollTo({ top: 0 });
  }, [chapterIdx, bookIdx, setChapterIdx, setBookIdx, setVStart, setVEnd, bible]);

  const nextChapter = useCallback(() => {
    if (chapterIdx < chapterCount - 1) {
      setChapterIdx(chapterIdx + 1);
      setVStart(1); setVEnd(0);
    } else if (bookIdx < bible.length - 1) {
      setBookIdx(bookIdx + 1);
      setChapterIdx(0);
      setVStart(1); setVEnd(0);
    }
    containerRef.current?.scrollTo({ top: 0 });
  }, [chapterIdx, chapterCount, bookIdx, bible, setChapterIdx, setBookIdx, setVStart, setVEnd]);

  const fontClass = fontFamily === 'serif' ? 'font-serif' : 'font-sans';
  const textAlign = justifyText ? 'text-justify' : '';

  const contentStyle = {
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeightPx}px`,
    width: readerWidthPct === 100 ? '100%' : `${readerWidthPct}%`,
    margin: readerWidthPct === 100 ? '0' : '0 auto',
    maxWidth: readerWidthPct === 100 ? 'none' : 'min(1100px, 100%)',
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto bg-white dark:bg-slate-900"
      style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="px-4 py-5"
        style={contentStyle}
      >
        {/* Chapter heading */}
        <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {book?.name}
            </h2>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Chapter {chapterIdx + 1}
              {vStartEff > 1 || vEnd > 0
                ? ` · verses ${vStartEff}–${vEndEff}`
                : ` · ${verseCount} verses`}
            </div>
          </div>

          {/* TTS controls */}
          <div className="flex items-center gap-2">
            {ttsStatus === 'idle' ? (
              <button
                onClick={() => onStartTTS(0)}
                title="Read aloud"
                className="h-8 w-8 rounded-lg border border-slate-300 dark:border-slate-600 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              >
                ▶
              </button>
            ) : (
              <>
                <button
                  onClick={onPauseTTS}
                  title={ttsStatus === 'playing' ? 'Pause' : 'Resume'}
                  className="h-8 w-8 rounded-lg border border-slate-300 dark:border-slate-600 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  {ttsStatus === 'playing' ? '⏸' : '▶'}
                </button>
                <button
                  onClick={onStopTTS}
                  title="Stop"
                  className="h-8 w-8 rounded-lg border border-slate-300 dark:border-slate-600 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  ⏹
                </button>
              </>
            )}
          </div>
        </div>

        {/* Verses */}
        {verses.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400 text-sm">No verses in this range.</p>
        ) : verseLayout === 'continuous' ? (
          <p className={cn(fontClass, textAlign, 'text-slate-800 dark:text-slate-200 leading-relaxed')}>
            {verses.map((v, i) => {
              const globalVn = vStartEff + i;
              return (
                <span key={i} data-verse={globalVn} className={cn(hoverHighlight && 'hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded')}>
                  {showNumbers && (
                    numberStyle === 'superscript' ? (
                      <sup className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mr-0.5 select-none">
                        {globalVn}
                      </sup>
                    ) : (
                      <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 mr-1 select-none">
                        {globalVn}.
                      </span>
                    )
                  )}
                  {autoHighlightSearchInRead && searchObj ? (
                    <HighlightText text={v} searchObj={searchObj} />
                  ) : v}
                  {' '}
                </span>
              );
            })}
          </p>
        ) : (
          <div className="space-y-1">
            {verses.map((v, i) => {
              const globalVn = vStartEff + i;
              return (
                <div
                  key={i}
                  data-verse={globalVn}
                  className={cn(
                    'py-1 px-2 rounded-lg transition-colors group',
                    hoverHighlight && 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  )}
                >
                  <span className={cn(fontClass, textAlign, 'text-slate-800 dark:text-slate-200')}>
                    {showNumbers && (
                      numberStyle === 'superscript' ? (
                        <sup className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mr-0.5 select-none">
                          {globalVn}
                        </sup>
                      ) : (
                        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 mr-1 select-none">
                          {globalVn}.
                        </span>
                      )
                    )}
                    {autoHighlightSearchInRead && searchObj ? (
                      <HighlightText text={v} searchObj={searchObj} />
                    ) : v}
                  </span>
                  {/* Verse actions */}
                  <button
                    onClick={() => {
                      const text = `${v}\n— ${book?.name} ${chapterIdx + 1}:${globalVn}`;
                      navigator.clipboard.writeText(text).catch(() => {});
                    }}
                    className="invisible group-hover:visible ml-2 text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                    title="Copy verse"
                  >
                    Copy
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Chapter navigation */}
        <div className="mt-8 flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={prevChapter}
            disabled={bookIdx === 0 && chapterIdx === 0}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ◀ Previous
          </button>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {book?.name} {chapterIdx + 1}
          </div>
          <button
            onClick={nextChapter}
            disabled={bookIdx === bible.length - 1 && chapterIdx === chapterCount - 1}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next ▶
          </button>
        </div>
      </motion.div>
    </div>
  );
}
