'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { parseStoredViewMode, viewPrefKey } from '@/lib/recipes/view-mode';
import type { ViewMode } from '@/lib/recipes/schemas';

// localStorage can throw (private windows, blocked storage): every access is guarded and an
// in-memory copy keeps the toggle working for the rest of the page session.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* fall through to memory */
  }
  return memory.get(key) ?? null;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

/** Per-user grid/list preference; `null` until chosen (and on the server). */
export function useViewPreference(userId: string): [ViewMode | null, (m: ViewMode) => void] {
  const key = viewPrefKey(userId);
  const stored = useSyncExternalStore(
    subscribe,
    () => parseStoredViewMode(read(key)),
    () => null,
  );
  const set = useCallback(
    (mode: ViewMode) => {
      memory.set(key, mode);
      try {
        localStorage.setItem(key, mode);
      } catch {
        /* memory copy is enough */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [stored, set];
}

/** Subscribes to a media query; `false` on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const PHONE_QUERY = '(max-width: 639px)';
