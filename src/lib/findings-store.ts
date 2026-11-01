import { useSyncExternalStore } from 'react';

import { fetchOpenFindings, type ApiError } from '@/lib/findings-api';
import type { Finding } from '@/types/finding';

export type FindingsState = {
  findings: Finding[];
  status: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  refreshing: boolean;
};

let state: FindingsState = { findings: [], status: 'loading', error: null, refreshing: false };
const listeners = new Set<() => void>();

function set(next: Partial<FindingsState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFindingsStore() {
  return useSyncExternalStore(subscribe, () => state);
}

export async function refreshFindings() {
  set(state.status === 'ready' ? { refreshing: true } : { status: 'loading', error: null });
  const result = await fetchOpenFindings();
  if (result.ok) {
    set({ findings: result.data, status: 'ready', error: null, refreshing: false });
  } else {
    set({ status: 'error', error: result.error, refreshing: false });
  }
}

export function removeFinding(id: string) {
  set({ findings: state.findings.filter((f) => f.id !== id) });
}
