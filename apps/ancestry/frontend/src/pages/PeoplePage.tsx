import { useState } from 'react';
import { usePeople } from '../hooks/usePeople';
import PersonCard from '../components/PersonCard';

export default function PeoplePage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { people, total, totalPages, loading, error } = usePeople(query, page);

  function handleSearch(value: string) {
    setQuery(value);
    setPage(1);
  }

  return (
    <div className="max-w-2xl mx-auto px-6">
      <header className="py-12 pb-8 border-b border-zinc-800">
        <h1 className="text-3xl font-bold tracking-tight">Schmid Family Tree</h1>
        <p className="mt-1.5 text-zinc-500 text-sm">Private family archive</p>
      </header>

      <main className="py-12">
        <section>
          <input
            type="text"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />

          <div className="mt-4">
            {error && <p className="text-red-400 text-sm">{error}</p>}

            {!error && (
              <>
                {!loading && (
                  <p className="text-xs text-zinc-500 mb-4">{total} people</p>
                )}

                {loading && (
                  <p className="text-zinc-500 text-sm">Loading…</p>
                )}

                {!loading && people.length === 0 && (
                  <p className="text-zinc-500 text-sm">No results.</p>
                )}

                <div className="space-y-2">
                  {people.map((p) => (
                    <PersonCard key={p.id} person={p} />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      ← Previous
                    </button>
                    <span className="text-xs text-zinc-500">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="py-8 border-t border-zinc-800 text-zinc-500 text-sm">
        Private family archive · built with Go + React
      </footer>
    </div>
  );
}
