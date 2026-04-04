import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { useState, useEffect } from 'react';
import PeoplePage from './pages/PeoplePage';
import PersonPage from './pages/PersonPage';
import TreePage from './pages/TreePage';
import { AuthProvider } from './lib/AuthContext';

function DefaultRoot() {
  const [rootId, setRootId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/default-root')
      .then((r) => r.json())
      .then((d) => setRootId(d.id))
      .catch(() => setRootId(null));
  }, []);

  if (rootId === null) return null;
  return <Navigate to={`/tree/${rootId}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="bg-zinc-950 text-zinc-200 font-sans leading-relaxed antialiased min-h-screen">
          <Routes>
            <Route path="/" element={<DefaultRoot />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/person/:id" element={<PersonPage />} />
            <Route path="/tree/:id" element={<TreePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-zinc-500 text-sm">Page not found.</p>
    </div>
  );
}
