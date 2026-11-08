/**
 * One history entry for the cook overlay, so browser Back / the Android back gesture closes it
 * (G15, Q9). The URL never changes (`pushState` without a url), same idea as `useLeaveGuard`.
 *
 * Close/Escape/Close button call `request()`: while our entry is on top that is `history.back()`,
 * and the popstate is the single close path. Cleanup removes the entry again if it is still on
 * top and the URL has not moved. `skip` counts our own `back()` calls so their popstate is not
 * taken for a user Back. Module-level so a strict-mode remount cannot misread it.
 */
export type HistoryEnv = {
  push: () => void;
  back: () => void;
  href: () => string;
};

let skip = 0;

export function createCookHistory(env: HistoryEnv, onClose: () => void) {
  let entry: string | null = null;
  return {
    open() {
      env.push();
      entry = env.href();
    },
    /** A popstate arrived. */
    pop() {
      if (skip > 0) {
        skip -= 1;
        return;
      }
      if (entry === null) return;
      entry = null;
      onClose();
    },
    request() {
      if (entry !== null) env.back();
      else onClose();
    },
    detach() {
      if (entry !== null && entry === env.href()) {
        skip += 1;
        env.back();
      }
      entry = null;
    },
  };
}

export const browserHistoryEnv: HistoryEnv = {
  push: () => window.history.pushState(null, ''),
  back: () => window.history.back(),
  href: () => window.location.href,
};

/** Test hook: forget stale skips between tests. */
export const resetCookHistorySkips = () => {
  skip = 0;
};
