import { useState } from 'react';
import { usePeople } from '../hooks/usePeople';
import PersonCard from '../components/PersonCard';
import { useAuth } from '../lib/AuthContext';
import { downloadGedcom } from '../lib/api';

export default function PeoplePage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { people, total, totalPages, loading, error } = usePeople(query, page);
  const { isEditor, login, logout } = useAuth();
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  function handleSearch(value: string) {
    setQuery(value);
    setPage(1);
  }

  async function handleLogin() {
    setLoggingIn(true);
    setLoginError('');
    const ok = await login(passwordInput);
    setLoggingIn(false);
    if (ok) {
      setShowPasswordPrompt(false);
      setPasswordInput('');
    } else {
      setLoginError('Incorrect password');
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6">
      <header className="py-12 pb-8 border-b border-zinc-800">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Schmid Family Tree</h1>
            <p className="mt-1.5 text-zinc-500 text-sm">Private family archive</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isEditor && (
              <button
                onClick={downloadGedcom}
                className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:border-violet-600 hover:text-violet-400 transition-colors"
                title="Export GEDCOM"
              >
                ↓ Export .ged
              </button>
            )}
            <button
              onClick={() => isEditor ? logout() : setShowPasswordPrompt((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                isEditor
                  ? 'bg-violet-950 border-violet-700 text-violet-300 hover:bg-violet-900'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-500'
              }`}
              title={isEditor ? 'Click to lock' : 'Editor login'}
            >
              {isEditor ? '🔓 Editor' : '🔒'}
            </button>
          </div>
        </div>

        {showPasswordPrompt && !isEditor && (
          <div className="mt-4 flex gap-2 items-center">
            <input
              type="password"
              placeholder="Password…"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              autoFocus
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={handleLogin}
              disabled={loggingIn}
              className="text-xs px-3 py-1.5 rounded-lg bg-violet-700 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
            >
              {loggingIn ? '…' : 'Unlock'}
            </button>
            {loginError && <span className="text-red-400 text-xs">{loginError}</span>}
          </div>
        )}
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
