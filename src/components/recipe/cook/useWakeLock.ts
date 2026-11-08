'use client';

import { useEffect, useState } from 'react';
import { createWakeLock, type WakeApi, type WakeStatus } from './wake-lock';

const browserApi = (): WakeApi | undefined => {
  const nav = navigator as Navigator & { wakeLock?: WakeApi };
  return nav.wakeLock && typeof nav.wakeLock.request === 'function' ? nav.wakeLock : undefined;
};

/** Requests the screen lock while mounted; returns the status for the one-line notice. */
export function useWakeLock(): WakeStatus {
  // Cook mode only mounts after a click (never server rendered), so reading `navigator` is safe.
  const [status, setStatus] = useState<WakeStatus>(() =>
    typeof navigator !== 'undefined' && !browserApi() ? 'unsupported' : 'pending',
  );
  useEffect(() => {
    const lock = createWakeLock({
      api: browserApi,
      visible: () => document.visibilityState === 'visible',
      onStatus: setStatus,
    });
    void lock.acquire();
    const onVis = () => lock.onVisibilityChange();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock.release();
    };
  }, []);
  return status;
}
