import type { PeopleResponse, PersonDetailResponse, TreeNode, Person } from './types';

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchPeople(
  q: string,
  page: number,
  signal?: AbortSignal,
): Promise<PeopleResponse> {
  const params = new URLSearchParams({ q, page: String(page) });
  return request<PeopleResponse>(`/api/people?${params}`, signal);
}

export function fetchPerson(id: string, signal?: AbortSignal): Promise<PersonDetailResponse> {
  return request<PersonDetailResponse>(`/api/person/${id}`, signal);
}

export function fetchTree(id: string, signal?: AbortSignal): Promise<TreeNode> {
  return request<TreeNode>(`/api/tree/${id}`, signal);
}

export async function updatePerson(id: string, data: Partial<Person>, secret: string): Promise<Person> {
  const res = await fetch(`/api/person/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<Person>;
}

export function fetchSiblings(id: string, signal?: AbortSignal): Promise<Person[]> {
  return request<Person[]>(`/api/siblings/${id}`, signal);
}

export function fetchDescendants(id: string, signal?: AbortSignal): Promise<TreeNode> {
  return request<TreeNode>(`/api/descendants/${id}`, signal);
}

export function downloadGedcom() {
  window.location.href = '/api/export/gedcom';
}
