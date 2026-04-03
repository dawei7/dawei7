import { Link, useParams } from 'react-router';
import { usePerson } from '../hooks/usePerson';
import { useTree } from '../hooks/useTree';
import AncestorTree from '../components/AncestorTree';
import { fullName } from '../lib/types';

export default function TreePage() {
  const { id = '' } = useParams();
  const person = usePerson(id);
  const tree = useTree(id);

  const name = person.data ? fullName(person.data.person) : '…';

  return (
    <div className="min-h-screen pb-20">
      <div className="max-w-2xl mx-auto px-6 py-10 pb-4">
        {person.data && (
          <Link
            to={`/person/${id}`}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Back to {name}
          </Link>
        )}
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight">Ancestor Tree</h1>
          <p className="text-zinc-700 text-xs mt-1">
            scroll to zoom · drag to pan · ↗ to open person · +/− to expand ancestors
          </p>
        </div>
      </div>

      {tree.loading && (
        <div className="px-6">
          <p className="text-zinc-500 text-sm">Loading tree…</p>
        </div>
      )}

      {tree.error && (
        <div className="px-6">
          <p className="text-red-400 text-sm">{tree.error}</p>
        </div>
      )}

      {tree.data && (
        <AncestorTree data={tree.data} rootId={id} />
      )}
    </div>
  );
}
