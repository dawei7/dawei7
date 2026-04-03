export interface Person {
  id: string;
  gedcom_id: string;
  first_name: string;
  last_name: string;
  maiden_name: string;
  sex: 'M' | 'F' | '';
  birth_date: string;
  birth_place: string;
  death_date: string;
  death_place: string;
  notes: string;
}

export interface FamilyView {
  spouse: Person | null;
  marriage_date: string;
  marriage_place: string;
  children: Person[];
}

export interface PeopleResponse {
  people: Person[];
  total: number;
}

export interface PersonDetailResponse {
  person: Person;
  father: Person | null;
  mother: Person | null;
  families: FamilyView[];
}

/** D3-compatible ancestor tree node */
export interface TreeNode {
  id: string;
  name: string;
  dates?: string;
  sex?: string;
  /** Genealogical parents — "children" in D3 hierarchy terms */
  children?: TreeNode[];
}

export function fullName(p: Pick<Person, 'first_name' | 'last_name'>): string {
  if (!p.first_name) return p.last_name;
  if (!p.last_name) return p.first_name;
  return `${p.first_name} ${p.last_name}`;
}
