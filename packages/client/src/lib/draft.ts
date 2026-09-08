import { useEffect, useState } from 'react';

export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Only edited fields go over the wire, with their original values for conflict checks. */
export function draftPatch<T extends object>(base: T, draft: T): { changes: Partial<T>; expected: Partial<T> } {
  const changes: Partial<T> = {}, expected: Partial<T> = {};
  for (const key of Object.keys(draft) as Array<keyof T>) {
    if (!sameValue(base[key], draft[key])) { changes[key] = draft[key]; expected[key] = base[key]; }
  }
  return { changes, expected };
}

export function mergeDraft<T extends object>(base: T, draft: T, latest: T): { base: T; draft: T } {
  const nextBase = { ...base }, nextDraft = { ...draft };
  for (const key of Object.keys(latest) as Array<keyof T>) {
    if (sameValue(base[key], draft[key])) { nextBase[key] = latest[key]; nextDraft[key] = latest[key]; }
  }
  return { base: nextBase, draft: nextDraft };
}

/** Dirty fields retain their baseline; untouched fields follow confirmed updates. */
export function useDraft<T extends object>(latest: T, revision: number) {
  const [state, setState] = useState({ base: latest, draft: latest, revision });
  const latestKey = JSON.stringify(latest);
  useEffect(() => { setState((s) => ({ ...s, ...mergeDraft(s.base, s.draft, latest) })); }, [latestKey]);
  const setField = <K extends keyof T>(key: K, value: T[K] | ((current: T[K]) => T[K])) => {
    setState((s) => ({ ...s, draft: { ...s.draft, [key]: typeof value === 'function' ? (value as (v: T[K]) => T[K])(s.draft[key]) : value } }));
  };
  const reset = () => setState({ base: latest, draft: latest, revision });
  const keepChanges = () => setState((s) => ({ base: latest, draft: mergeDraft(s.base, s.draft, latest).draft, revision }));
  const conflicts = Object.keys(draftPatch(state.base, state.draft).changes).filter((key) =>
    !sameValue(state.base[key as keyof T], latest[key as keyof T]) && !sameValue(state.draft[key as keyof T], latest[key as keyof T]));
  return { ...state, setField, reset, keepChanges, conflicts };
}
