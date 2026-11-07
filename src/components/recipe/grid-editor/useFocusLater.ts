'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Focus an element that only exists after the next render (a restored, moved or new row).
 * `focusLater(finder)` stores the finder; the effect below runs it after every commit until it
 * finds something once. Focus is always on a stable client key, never on `body` (UX spec 15).
 */
export function useFocusLater() {
  const pending = useRef<(() => HTMLElement | null) | null>(null);
  const focusLater = useCallback((finder: () => HTMLElement | null) => {
    pending.current = finder;
  }, []);
  useEffect(() => {
    const finder = pending.current;
    if (!finder) return;
    const el = finder();
    if (el) {
      pending.current = null;
      el.focus();
    }
  });
  return focusLater;
}

/** Finder helpers over the editor root. */
export const byTarget = (root: RefObject<HTMLElement | null>, id: string) => () =>
  Array.from(root.current?.querySelectorAll<HTMLElement>('[data-ge-target]') ?? []).find(
    (el) => el.dataset.geTarget === id,
  ) ?? null;
export const byAttr = (root: RefObject<HTMLElement | null>, attr: string, value: string) => () =>
  Array.from(root.current?.querySelectorAll<HTMLElement>(`[${attr}]`) ?? []).find(
    (el) => el.getAttribute(attr) === value,
  ) ?? null;
