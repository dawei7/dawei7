import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useRef } from 'react';
import { usePerson } from '../hooks/usePerson';
import { useTree } from '../hooks/useTree';
import { usePeople } from '../hooks/usePeople';
import AncestorTree from '../components/AncestorTree';
import { fullName } from '../lib/types';
import { fetchDescendants, downloadGedcom } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import type { TreeNode } from '../lib/types';

export default function TreePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const person = usePerson(id);
  const tree = useTree(id);
  const [descendants, setDescendants] = useState<TreeNode | null>(null);
  const { isEditor, login, logout } = useAuth();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const { people: searchResults } = usePeople(searchQuery, 1);
  const searchRef = useRef<HTMLDivElement>(null);

  // Password prompt
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetchDescendants(id, ctrl.signal)
      .then(setDescendants)
      .catch(() => setDescendants(null));
    return () => ctrl.abort();
  }, [id]);

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleLogin() {
    setLoggingIn(true); setLoginError('');
    const ok = await login(passwordInput);
    setLoggingIn(false);
    if (ok) { setShowPasswordPrompt(false); setPasswordInput(''); }
    else setLoginError('Incorrect password');
  }

  const name = person.data ? fullName(person.data.person) : '…';

  return (
    <div className="min-h-screen pb-20">
      {/* Top bar */}
      <div className="max-w-5xl mx-auto px-6 py-6 flex items-center gap-4">
        {/* Title */}
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight">Schmid Family Tree</h1>
          <p className="text-zinc-600 text-xs mt-0.5">
            scroll to zoom · drag to pan · ⌂ set root · ≡ siblings · +/− expand
          </p>
        </div>

        {/* Search box */}
        <div ref={searchRef} className="relative w-64">
          <input
            type="text"
            placeholder="Search person…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
          />
          {searchOpen && searchQuery.length > 0 && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto">
              {searchResults.slice(0, 20).map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors border-b border-zinc-800/50 last:border-0"
                  onClick={() => { navigate(`/tree/${p.id}`); setSearchQuery(''); setSearchOpen(false); }}
                >
                  <span className="font-medium">{fullName(p)}</span>
                  {p.birth_date && <span className="text-zinc-500 text-xs ml-2">b. {p.birth_date}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Auth + export */}
        <div className="flex items-center gap-2 shrink-0">
          {isEditor && (
            <button onClick={downloadGedcom}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:border-violet-600 hover:text-violet-400 transition-colors"
              title="Export GEDCOM">
              ↓ .ged
            </button>
          )}
          <button
            onClick={() => isEditor ? logout() : setShowPasswordPrompt((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              isEditor
                ? 'bg-violet-950 border-violet-700 text-violet-300 hover:bg-violet-900'
                : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-500'
            }`}
            title={isEditor ? 'Click to lock' : 'Editor login'}>
            {isEditor ? '🔓' : '🔒'}
          </button>
        </div>
      </div>

      {/* Login prompt */}
      {showPasswordPrompt && !isEditor && (
        <div className="max-w-5xl mx-auto px-6 pb-4 flex gap-2 items-center">
          <input type="password" placeholder="Password…" value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} autoFocus
            className="w-48 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500" />
          <button onClick={handleLogin} disabled={loggingIn}
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-700 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors">
            {loggingIn ? '…' : 'Unlock'}
          </button>
          {loginError && <span className="text-red-400 text-xs">{loginError}</span>}
        </div>
      )}

      {/* Current root indicator */}
      {person.data && (
        <div className="max-w-5xl mx-auto px-6 pb-2">
          <span className="text-xs text-zinc-600">Viewing: <span className="text-zinc-400">{name}</span></span>
        </div>
      )}

      {tree.loading && <div className="px-6"><p className="text-zinc-500 text-sm">Loading tree…</p></div>}
      {tree.error && <div className="px-6"><p className="text-red-400 text-sm">{tree.error}</p></div>}
      {tree.data && (
        <AncestorTree data={tree.data} rootId={id} descendants={descendants ?? undefined} />
      )}
    </div>
  );
}

