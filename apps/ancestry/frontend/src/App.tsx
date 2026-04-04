import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import PeoplePage from './pages/PeoplePage';
import PersonPage from './pages/PersonPage';
import TreePage from './pages/TreePage';
import { AuthProvider } from './lib/AuthContext';

const DEFAULT_ROOT_ID = '0b252376-5b6b-40f2-944d-f5d0054573ba'; // David Schmid

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="bg-zinc-950 text-zinc-200 font-sans leading-relaxed antialiased min-h-screen">
          <Routes>
            <Route path="/" element={<Navigate to={`/tree/${DEFAULT_ROOT_ID}`} replace />} />
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
