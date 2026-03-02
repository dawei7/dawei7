'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { defaultLocaleFor } from '@/lib/utils';

export type TtsStatus = 'idle' | 'playing' | 'paused';

export function useTTS(langCode: string = 'en') {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [status, setStatus] = useState<TtsStatus>('idle');
  const [rate, setRate] = useState(0.95);
  const [voicePrefs, setVoicePrefs] = useState<Record<string, string>>({});
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const queueRef = useRef<string[]>([]);
  const queueIdxRef = useRef(0);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setStatus('idle');
    queueRef.current = [];
    queueIdxRef.current = 0;
  }, [supported]);

  const playNext = useCallback(() => {
    if (!supported) return;
    const texts = queueRef.current;
    const idx = queueIdxRef.current;
    if (idx >= texts.length) { setStatus('idle'); return; }

    const utt = new SpeechSynthesisUtterance(texts[idx]);
    utt.rate = rate;
    const locale = defaultLocaleFor(langCode);
    utt.lang = locale;

    const pref = voicePrefs[langCode.toLowerCase()];
    if (pref) {
      const v = window.speechSynthesis.getVoices().find((v) => v.name === pref);
      if (v) utt.voice = v;
    }

    utt.onend = () => {
      queueIdxRef.current++;
      playNext();
    };
    utt.onerror = () => setStatus('idle');
    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
    setStatus('playing');
  }, [supported, rate, langCode, voicePrefs]);

  const play = useCallback(
    (verses: string[], startIdx = 0) => {
      if (!supported) return;
      stop();
      queueRef.current = verses;
      queueIdxRef.current = startIdx;
      playNext();
    },
    [supported, stop, playNext]
  );

  const pause = useCallback(() => {
    if (!supported) return;
    if (status === 'playing') {
      window.speechSynthesis.pause();
      setStatus('paused');
    } else if (status === 'paused') {
      window.speechSynthesis.resume();
      setStatus('playing');
    }
  }, [supported, status]);

  // Stop on unmount
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  return { supported, status, rate, setRate, voicePrefs, setVoicePrefs, play, pause, stop };
}
