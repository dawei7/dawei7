import { useState, useEffect } from 'react';
import { fetchTree } from '../lib/api';
import type { TreeNode } from '../lib/types';

interface State {
  data: TreeNode | null;
  loading: boolean;
  error: string | null;
}

export function useTree(id: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });

    fetchTree(id, controller.signal)
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
