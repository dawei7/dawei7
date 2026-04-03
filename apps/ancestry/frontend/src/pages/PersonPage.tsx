import { Link, useParams } from 'react-router';
import { usePerson } from '../hooks/usePerson';
import PersonCard from '../components/PersonCard';
import { fullName } from '../lib/types';

export default function PersonPage() {
  const { id = '' } = useParams();
  const { data, loading, error } = usePerson(id);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-zinc-500 text-sm">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { person, father, mother, families } = data;
  const name = fullName(person);

  return (
    <div className="max-w-2xl mx-auto px-6">
      <header className="py-10 pb-8 border-b border-zinc-800">
        <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          ← All people
        </Link>
        <div className="flex items-start justify-between mt-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
            {person.maiden_name && (
              <p className="text-zinc-500 text-sm mt-1">née {person.maiden_name}</p>
            )}
          </div>
          <Link
            to={`/tree/${person.id}`}
            className="shrink-0 ml-4 mt-1 text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:border-violet-600 hover:text-violet-400 transition-colors"
          >
            Ancestor Tree →
          </Link>
        </div>
      </header>

      <main className="py-10 space-y-10">
        {/* Details */}
        <section>
          <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">
            Details
          </h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-2 text-sm">
            {(person.birth_date || person.birth_place) && (
              <div className="flex gap-3">
                <span className="text-zinc-500 w-16 shrink-0">Born</span>
                <span>
                  {person.birth_date}
                  {person.birth_place && ` · ${person.birth_place}`}
                </span>
              </div>
            )}
            {(person.death_date || person.death_place) && (
              <div className="flex gap-3">
                <span className="text-zinc-500 w-16 shrink-0">Died</span>
                <span>
                  {person.death_date}
                  {person.death_place && ` · ${person.death_place}`}
                </span>
              </div>
            )}
            {(person.burial_date || person.burial_place) && (
              <div className="flex gap-3">
                <span className="text-zinc-500 w-16 shrink-0">Buried</span>
                <span>
                  {person.burial_date}
                  {person.burial_place && ` · ${person.burial_place}`}
                </span>
              </div>
            )}
            {person.occupation && (
              <div className="flex gap-3">
                <span className="text-zinc-500 w-16 shrink-0">Occupation</span>
                <span>{person.occupation}</span>
              </div>
            )}
            {person.sex === 'M' && (
              <div className="flex gap-3">
                <span className="text-zinc-500 w-16 shrink-0">Sex</span>
                <span>Male</span>
              </div>
            )}
            {person.sex === 'F' && (
              <div className="flex gap-3">
                <span className="text-zinc-500 w-16 shrink-0">Sex</span>
                <span>Female</span>
              </div>
            )}
          </div>
        </section>

        {/* Parents */}
        {(father || mother) && (
          <section>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">
              Parents
            </h2>
            <div className="space-y-2">
              {father && <PersonCard person={father} role="Father" />}
              {mother && <PersonCard person={mother} role="Mother" />}
            </div>
          </section>
        )}

        {/* Families */}
        {families.map((fam, i) => (
          <section key={i}>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">
              Family
            </h2>
            {fam.spouse && (
              <div className="mb-4">
                <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wide">Spouse</p>
                <PersonCard person={fam.spouse} />
                {(fam.marriage_date || fam.marriage_place) && (
                  <p className="text-xs text-zinc-600 mt-1 ml-1">
                    Married
                    {fam.marriage_date && ` ${fam.marriage_date}`}
                    {fam.marriage_place && ` · ${fam.marriage_place}`}
                  </p>
                )}
                {(fam.divorce_date || fam.divorce_place) && (
                  <p className="text-xs text-zinc-600 mt-1 ml-1">
                    Divorced
                    {fam.divorce_date && ` ${fam.divorce_date}`}
                    {fam.divorce_place && ` · ${fam.divorce_place}`}
                  </p>
                )}
              </div>
            )}
            {fam.children.length > 0 && (
              <div>
                <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wide">Children</p>
                <div className="space-y-2">
                  {fam.children.map((child) => (
                    <PersonCard key={child.id} person={child} />
                  ))}
                </div>
              </div>
            )}
          </section>
        ))}

        {/* Notes */}
        {person.notes && (
          <section>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">
              Notes
            </h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 text-sm text-zinc-400 whitespace-pre-wrap">
              {person.notes}
            </div>
          </section>
        )}
      </main>

      <footer className="py-8 border-t border-zinc-800 text-zinc-500 text-sm">
        Private family archive · built with Go + React
      </footer>
    </div>
  );
}
