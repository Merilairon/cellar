// Generic undo/redo over immutable snapshots (structural sharing; nothing is deep-copied).
// No timers: consecutive edits coalesce only when the caller passes the same `groupKey`.

export const HISTORY_CAP = 100;

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  /** The snapshot last saved; dirty means `present !== saved` (identity, not deep equality). */
  saved: T;
  /** groupKey of the entry currently being coalesced into, if any. */
  group: string | null;
};

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], saved: present, group: null };
}

/** Record `next` as the new present. Same group key as the previous commit replaces instead of pushing. */
export function commit<T>(h: History<T>, next: T, groupKey?: string): History<T> {
  if (next === h.present) return h;
  if (groupKey !== undefined && h.group === groupKey && h.past.length > 0) {
    return { ...h, present: next, future: [] };
  }
  const past = [...h.past, h.present];
  if (past.length > HISTORY_CAP) past.shift();
  return { ...h, past, present: next, future: [], group: groupKey ?? null };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}
export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  return {
    ...h,
    past,
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
    group: null,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...future] = h.future;
  return { ...h, past: [...h.past, h.present], present: next, future, group: null };
}

export function markSaved<T>(h: History<T>): History<T> {
  return h.saved === h.present && h.group === null ? h : { ...h, saved: h.present, group: null };
}

export function isDirty<T>(h: History<T>): boolean {
  return h.present !== h.saved;
}
