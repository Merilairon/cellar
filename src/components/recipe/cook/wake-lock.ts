/**
 * Screen Wake Lock for cook mode (G14). Pure controller with an injected environment so it can be
 * unit-tested with a stub. It never throws and never rejects: every failure becomes a status.
 *
 * `navigator.wakeLock` exists only in secure contexts (HTTPS or localhost), so on a plain-HTTP LAN
 * install the status is `unsupported` and everything else keeps working. The browser releases the
 * lock whenever the page is hidden, so it is requested again when the page becomes visible.
 */
export type WakeStatus = 'pending' | 'on' | 'unsupported' | 'failed';

type Sentinel = {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', fn: () => void) => void;
};
export type WakeApi = { request: (type: 'screen') => Promise<Sentinel> };

export type WakeEnv = {
  /** `navigator.wakeLock` when the feature exists, else undefined. */
  api: () => WakeApi | undefined;
  visible: () => boolean;
  onStatus: (s: WakeStatus) => void;
};

export function createWakeLock(env: WakeEnv) {
  let sentinel: Sentinel | null = null;
  let requesting = false;
  let disposed = false;

  const acquire = async (): Promise<void> => {
    if (disposed || requesting || sentinel) return;
    let api: WakeApi | undefined;
    try {
      api = env.api();
    } catch {
      api = undefined;
    }
    if (!api) {
      env.onStatus('unsupported');
      return;
    }
    // A hidden page is refused by the browser; the visibility handler asks again later.
    if (!env.visible()) return;
    requesting = true;
    try {
      const s = await api.request('screen');
      if (disposed) {
        s.release().catch(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener?.('release', () => {
        if (sentinel === s) sentinel = null;
      });
      env.onStatus('on');
    } catch {
      env.onStatus('failed');
    } finally {
      requesting = false;
    }
  };

  return {
    acquire,
    /** Call on `visibilitychange`: re-request silently once the page is visible again. */
    onVisibilityChange() {
      if (env.visible()) void acquire();
    },
    release() {
      disposed = true;
      const s = sentinel;
      sentinel = null;
      if (s) s.release().catch(() => {});
    },
  };
}
