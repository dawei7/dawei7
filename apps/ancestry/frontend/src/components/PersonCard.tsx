import { memo } from 'react';
import { Link } from 'react-router';
import { fullName } from '../lib/types';
import type { Person } from '../lib/types';

interface Props {
  person: Person;
  role?: string;
}

const PersonCard = memo(function PersonCard({ person, role }: Props) {
  const name = fullName(person);
  const dates = [
    person.birth_date ? `b. ${person.birth_date}` : '',
    person.death_date ? `d. ${person.death_date}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      to={`/person/${person.id}`}
      className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-3 hover:border-zinc-700 transition-colors"
    >
      <span className="font-medium text-sm">{name}</span>
      <span className="text-zinc-500 text-xs">
        {role ? [role, dates].filter(Boolean).join(' · ') : dates}
      </span>
    </Link>
  );
});

export default PersonCard;
