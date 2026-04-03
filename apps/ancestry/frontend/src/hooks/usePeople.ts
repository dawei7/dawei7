import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchPeople } from '../lib/api';
import type { Person } from '../lib/types';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

interface State {
  people: Person[];
  total: number;
  loading: boolean;
  error: string | null;
}

export function usePeople(query: string, page: number) {
  const [state, setState] = useState<State>({ people: [], total: 0, loading: true, error: null });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (q: string, p: number, signal: AbortSignal) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      fetchPeople(q, p, signal)
        .then((data) => {
          if (!signal.aborted) {
            setState({ people: data.people ?? [], total: data.total, loading: false, error: null });
          }
        })
        .catch((err: unknown) => {
          if (!signal.aborted) {
            setState((s) => ({
              ...s,
              loading: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            }));
          }
        });
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => load(query, page, controller.signal), DEBOUNCE_MS);

    return () => {
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, page, load]);

  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  return { ...state, totalPages };
}
