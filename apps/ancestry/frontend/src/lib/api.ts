import type { PeopleResponse, PersonDetailResponse, TreeNode } from './types';

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
