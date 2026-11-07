'use client';

import { useEffect, useRef } from 'react';

/**
 * History trick for the leave guard (v0.4.1 F2). The editor is component state, not a route, so
 * browser Back, the Android back gesture and the iOS edge swipe would leave the recipe page and
 * drop the edits. While `dirty` there is one extra history entry on top of the page's own; Back
 * pops it, the handler pushes it again at once and calls `onAttempt` (the editor's leave
 * confirm). Going clean (saved, undone to the start) removes the entry again; so does closing the
 * editor while it is still there. The URL never changes (`pushState` without a url).
 *
 * Not covered: the header links. Next 16 has no global navigation-blocking hook and `<Link
 * onNavigate>` is per link, so those stay a documented gap (only `beforeunload` covers a reload
 * or a tab close).
 */
export function useLeaveGuard(dirty: boolean, onAttempt: () => void) {
  // The href of the guard entry while it is believed to be on top of the stack.
  const entry = useRef<string | null>(null);
  // `history.back()` calls we made ourselves whose popstate has not arrived yet.
  const skip = useRef(0);
  const dirtyRef = useRef(dirty);
  const attempt = useRef(onAttempt);
  useEffect(() => {
    attempt.current = onAttempt;
  });

  useEffect(() => {
    dirtyRef.current = dirty;
    if (dirty && entry.current === null && skip.current === 0) {
      window.history.pushState(null, '');
      entry.current = window.location.href;
    } else if (!dirty && entry.current !== null) {
      entry.current = null;
      skip.current += 1;
      window.history.back();
    }
  }, [dirty]);

  useEffect(() => {
    const onPop = () => {
      if (skip.current > 0) {
        skip.current -= 1;
        // Went dirty again while our own back() was still travelling.
        if (skip.current === 0 && dirtyRef.current && entry.current === null) {
          window.history.pushState(null, '');
          entry.current = window.location.href;
        }
        return;
      }
      if (entry.current === null) return; // not ours: the user left the guarded state
      entry.current = null;
      if (dirtyRef.current) {
        window.history.pushState(null, '');
        entry.current = window.location.href;
        attempt.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed while the entry is on top (Cancel then Discard): pop it, but not when the page
      // is unmounting because a link already moved the URL somewhere else.
      if (entry.current !== null && entry.current === window.location.href) {
        window.history.back();
      }
      entry.current = null;
    };
  }, []);
}
