import { useSyncExternalStore } from 'react';

import fakeFindings from '@/data/fake-findings.json';
import type { Finding } from '@/types/finding';

let findings: Finding[] = fakeFindings as Finding[];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFindings() {
  return useSyncExternalStore(subscribe, () => findings);
}

export function resolveFinding(id: string) {
  findings = findings.filter((f) => f.id !== id);
  listeners.forEach((listener) => listener());
}
