'use client';

import { useEffect, useState } from 'react';

/**
 * History trick for the leave guard (v0.4.1 F2). The editor is component state, not a route, so
 * browser Back, the Android back gesture and the iOS edge swipe would leave the recipe page and
 * drop the edits. While `dirty` there is one extra history entry on top of the page's own; Back
 * pops it, the handler pushes it again at once and calls `onAttempt` (the editor's leave
 * confirm). Going clean (saved, undone to the start) removes the entry again; so does closing the
 * editor while it is still there. The URL never changes (`pushState` without a url).
 *
 * Our own `history.back()` calls are counted (`skip`) so their popstate is not taken for a user
 * Back. Two safeguards: every `back()` we issue bumps the counter (including the unmount
 * cleanup, which Fast Refresh and strict mode re-run), and a `back()` whose popstate never
 * arrives is given up after `SKIP_TIMEOUT_MS`, after which the guard re-arms if still dirty.
 *
 * Unverified against Next's own popstate handling beyond the e2e leave-guard tests (Next 16.4.5):
 * the entry is pushed with a null state and popped again on every Back attempt; the e2e tests
 * show no URL change, scroll reset or refetch on that path, nothing more.
 *
 * Not covered: the header links. Next 16 has no global navigation-blocking hook and `<Link
 * onNavigate>` is per link, so those stay a documented gap (only `beforeunload` covers a reload
 * or a tab close).
 */
export const SKIP_TIMEOUT_MS = 1000;

export type GuardEnv = {
  push: () => void;
  back: () => void;
  href: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
};

export function createLeaveGuard(env: GuardEnv, initialAttempt: () => void) {
  let onAttempt = initialAttempt;
  // The href of the guard entry while it is believed to be on top of the stack.
  let entry: string | null = null;
  // `history.back()` calls we made ourselves whose popstate has not arrived yet.
  let skip = 0;
  let dirty = false;
  let attached = false;
  let timer: unknown = null;

  const stopTimer = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };
  const arm = () => {
    env.push();
    entry = env.href();
  };
  const goBack = () => {
    skip += 1;
    env.back();
    stopTimer();
    timer = env.setTimer(() => {
      timer = null;
      skip = 0; // the popstate never came: stop waiting for it
      if (attached && dirty && entry === null) arm();
    }, SKIP_TIMEOUT_MS);
  };

  return {
    setOnAttempt(fn: () => void) {
      onAttempt = fn;
    },
    attach() {
      attached = true;
    },
    setDirty(next: boolean) {
      dirty = next;
      if (dirty && entry === null && skip === 0) arm();
      else if (!dirty && entry !== null) {
        entry = null;
        goBack();
      }
    },
    pop() {
      if (skip > 0) {
        skip -= 1;
        if (skip === 0) stopTimer();
        // Went dirty again while our own back() was still travelling.
        if (skip === 0 && dirty && entry === null) arm();
        return;
      }
      if (entry === null) return; // not ours: the user left the guarded state
      entry = null;
      if (dirty) {
        arm();
        onAttempt();
      }
    },
    /** Effect cleanup: close while the entry is on top, but not when a link already moved the URL. */
    detach() {
      attached = false;
      if (entry !== null && entry === env.href()) goBack();
      entry = null;
    },
  };
}

const browserEnv: GuardEnv = {
  push: () => window.history.pushState(null, ''),
  back: () => window.history.back(),
  href: () => window.location.href,
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (t) => window.clearTimeout(t as number),
};

export function useLeaveGuard(dirty: boolean, onAttempt: () => void) {
  const [guard] = useState(() => createLeaveGuard(browserEnv, () => {}));
  useEffect(() => {
    guard.setOnAttempt(onAttempt);
  });

  useEffect(() => {
    guard.setDirty(dirty);
  }, [guard, dirty]);

  useEffect(() => {
    guard.attach();
    const onPop = () => guard.pop();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      guard.detach();
    };
  }, [guard]);
}
