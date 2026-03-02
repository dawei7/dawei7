'use client';

import dynamic from 'next/dynamic';

// BibleApp is a heavyweight client component — load it dynamically so the
// server bundle stays small and the loading spinner shows while JS is parsing.
const BibleApp = dynamic(() => import('@/components/BibleApp'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="text-center space-y-3">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600 text-white grid place-content-center font-black text-xl mx-auto select-none">
          ΑΩ
        </div>
        <div className="text-lg font-semibold text-slate-700 dark:text-slate-200">Loading Bible…</div>
        <div className="text-sm text-slate-500 dark:text-slate-400">Bible Reader · Smart Search</div>
      </div>
    </div>
  ),
});

export default function Home() {
  return <BibleApp />;
}
