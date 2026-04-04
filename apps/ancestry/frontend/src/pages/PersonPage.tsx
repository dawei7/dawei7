import { useState, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { usePerson } from '../hooks/usePerson';
import PersonCard from '../components/PersonCard';
import { fullName } from '../lib/types';
import { useAuth } from '../lib/AuthContext';
import { updatePerson } from '../lib/api';
import type { Person } from '../lib/types';

// ── Field row (view) ────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-2 border-b border-zinc-800/60 last:border-0">
      <span className="text-zinc-500 text-xs uppercase tracking-wide w-24 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-zinc-200">{value}</span>
    </div>
  );
}

// ── Field input ─────────────────────────────────────────────────────────────
function Field({
  label, name, value, onChange, type = 'text',
}: {
  label: string; name: keyof Person; value: string;
  onChange: (name: keyof Person, value: string) => void; type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500 uppercase tracking-wide">{label}</label>
      {type === 'textarea' ? (
        <textarea rows={4} value={value} onChange={(e) => onChange(name, e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500 resize-none" />
      ) : type === 'select-sex' ? (
        <select value={value} onChange={(e) => onChange(name, e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500">
          <option value="">Unknown</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(name, e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500" />
      )}
    </div>
  );
}

export default function PersonPage() {
  const { id = '' } = useParams();
  const { data, loading, error } = usePerson(id);
  const { isEditor, secret } = useAuth();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Person | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    if (data) { setDraft({ ...data.person }); setEditing(true); setSaveError(null); }
  }, [data]);

  const cancelEdit = useCallback(() => {
    setEditing(false); setDraft(null); setSaveError(null);
  }, []);

  const handleField = useCallback((name: keyof Person, value: string) => {
    setDraft((prev) => prev ? { ...prev, [name]: value } : prev);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true); setSaveError(null);
    try {
      await updatePerson(id, draft, secret);
      window.location.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }, [draft, id, secret]);

  if (loading) return <div className="max-w-2xl mx-auto px-6 py-16"><p className="text-zinc-500 text-sm">Loading…</p></div>;
  if (error) return <div className="max-w-2xl mx-auto px-6 py-16"><p className="text-red-400 text-sm">{error}</p></div>;
  if (!data) return null;

  const { person, father, mother, families } = data;
  const name = fullName(person);
  const sexLabel = person.sex === 'M' ? 'Male' : person.sex === 'F' ? 'Female' : '';
  const accentBorder = person.sex === 'M' ? 'border-l-blue-700' : person.sex === 'F' ? 'border-l-pink-700' : 'border-l-zinc-700';

  return (
    <div className="max-w-2xl mx-auto px-6">
      <header className="py-10 pb-8 border-b border-zinc-800">
        <Link to={`/tree/${person.id}`} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← Ancestor Tree</Link>
        <div className="flex items-start justify-between mt-3 gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
            {person.maiden_name && <p className="text-zinc-500 text-sm mt-1">née {person.maiden_name}</p>}
            {person.occupation && <p className="text-violet-400 text-sm mt-1">{person.occupation}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {isEditor && !editing && (
              <button onClick={startEdit}
                className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:border-violet-600 hover:text-violet-400 transition-colors">
                ✎ Edit
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="py-10 space-y-10">
        {editing && draft && (
          <section className="bg-zinc-900 border border-violet-800/50 rounded-xl p-6">
            <h2 className="text-xs font-semibold tracking-widest uppercase text-violet-400 mb-5">Editing {name}</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name" name="first_name" value={draft.first_name} onChange={handleField} />
              <Field label="Last name" name="last_name" value={draft.last_name} onChange={handleField} />
              <Field label="Maiden name" name="maiden_name" value={draft.maiden_name} onChange={handleField} />
              <Field label="Sex" name="sex" value={draft.sex} onChange={handleField} type="select-sex" />
              <Field label="Birth date" name="birth_date" value={draft.birth_date} onChange={handleField} />
              <Field label="Birth place" name="birth_place" value={draft.birth_place} onChange={handleField} />
              <Field label="Death date" name="death_date" value={draft.death_date} onChange={handleField} />
              <Field label="Death place" name="death_place" value={draft.death_place} onChange={handleField} />
              <Field label="Burial date" name="burial_date" value={draft.burial_date} onChange={handleField} />
              <Field label="Burial place" name="burial_place" value={draft.burial_place} onChange={handleField} />
              <Field label="Occupation" name="occupation" value={draft.occupation} onChange={handleField} />
            </div>
            <div className="mt-4">
              <Field label="Notes" name="notes" value={draft.notes} onChange={handleField} type="textarea" />
            </div>
            {saveError && <p className="text-red-400 text-xs mt-3">{saveError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-violet-700 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={cancelEdit}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 transition-colors">
                Cancel
              </button>
            </div>
          </section>
        )}

        {!editing && (
          <section>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">Details</h2>
            <div className={`bg-zinc-900 border border-zinc-800 border-l-4 ${accentBorder} rounded-lg px-5 py-3`}>
              <Row label="Born" value={[person.birth_date, person.birth_place].filter(Boolean).join(' · ')} />
              <Row label="Died" value={[person.death_date, person.death_place].filter(Boolean).join(' · ')} />
              <Row label="Buried" value={[person.burial_date, person.burial_place].filter(Boolean).join(' · ')} />
              <Row label="Occupation" value={person.occupation} />
              {sexLabel && <Row label="Sex" value={sexLabel} />}
            </div>
          </section>
        )}

        {(father || mother) && (
          <section>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">Parents</h2>
            <div className="space-y-2">
              {father && <PersonCard person={father} role="Father" />}
              {mother && <PersonCard person={mother} role="Mother" />}
            </div>
          </section>
        )}

        {families.map((fam, i) => (
          <section key={i}>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">Family</h2>
            {fam.spouse && (
              <div className="mb-4">
                <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wide">Spouse</p>
                <PersonCard person={fam.spouse} />
                {(fam.marriage_date || fam.marriage_place) && (
                  <p className="text-xs text-zinc-600 mt-2 ml-1">
                    💍 Married{fam.marriage_date && ` ${fam.marriage_date}`}{fam.marriage_place && ` · ${fam.marriage_place}`}
                  </p>
                )}
                {(fam.divorce_date || fam.divorce_place) && (
                  <p className="text-xs text-zinc-600 mt-1 ml-1">
                    Divorced{fam.divorce_date && ` ${fam.divorce_date}`}{fam.divorce_place && ` · ${fam.divorce_place}`}
                  </p>
                )}
              </div>
            )}
            {fam.children.length > 0 && (
              <div>
                <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wide">Children ({fam.children.length})</p>
                <div className="space-y-2">
                  {fam.children.map((child) => <PersonCard key={child.id} person={child} />)}
                </div>
              </div>
            )}
          </section>
        ))}

        {person.notes && !editing && (
          <section>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-zinc-500 mb-4">Notes</h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 text-sm text-zinc-400 whitespace-pre-wrap">
              {person.notes}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
