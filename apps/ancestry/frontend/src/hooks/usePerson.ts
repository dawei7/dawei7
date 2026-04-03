import { useState, useEffect } from 'react';
import { fetchPerson } from '../lib/api';
import type { PersonDetailResponse } from '../lib/types';

interface State {
  data: PersonDetailResponse | null;
  loading: boolean;
  error: string | null;
}

export function usePerson(id: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });

    fetchPerson(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      });

    return () => controller.abort();
  }, [id]);

  return state;
}
