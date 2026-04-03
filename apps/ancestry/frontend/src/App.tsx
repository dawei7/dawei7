import { BrowserRouter, Routes, Route } from 'react-router';
import PeoplePage from './pages/PeoplePage';
import PersonPage from './pages/PersonPage';
import TreePage from './pages/TreePage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="bg-zinc-950 text-zinc-200 font-sans leading-relaxed antialiased min-h-screen">
        <Routes>
          <Route path="/" element={<PeoplePage />} />
          <Route path="/person/:id" element={<PersonPage />} />
          <Route path="/tree/:id" element={<TreePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-zinc-500 text-sm">Page not found.</p>
    </div>
  );
}
