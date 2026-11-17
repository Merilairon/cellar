import { getEnv } from '@/lib/env';
import { getRateLimiter } from './rate-limit';

/** Per-user limiter for GET /api/export (env: RATE_LIMIT_EXPORT_MAX / _WINDOW_SEC). */
export function exportLimiter() {
  const e = getEnv();
  return getRateLimiter('export:user', {
    limit: e.RATE_LIMIT_EXPORT_MAX,
    windowMs: e.RATE_LIMIT_EXPORT_WINDOW_SEC * 1000,
  });
}

/** Per-user limiter for staging a restore upload (env: RATE_LIMIT_RESTORE_MAX / _WINDOW_SEC). */
export function restoreLimiter() {
  const e = getEnv();
  return getRateLimiter('restore:user', {
    limit: e.RATE_LIMIT_RESTORE_MAX,
    windowMs: e.RATE_LIMIT_RESTORE_WINDOW_SEC * 1000,
  });
}

// One export in flight per user. Shared on globalThis like the limiter registry so separately
// bundled route modules see the same set. A lease older than STALE_MS is treated as free: the
// stream's close hook is the real release, this only bounds a leak if a response is dropped
// without ever being read or cancelled.
const STALE_MS = 6 * 60 * 60 * 1000;
const registry = globalThis as unknown as { __exportInFlight?: Map<string, number> };

/**
 * Take the user's export slot. Returns a release function (idempotent), or null when an export
 * is already running for that user.
 */
export function acquireExport(userId: string, now: number = Date.now()): (() => void) | null {
  const map = (registry.__exportInFlight ??= new Map());
  const held = map.get(userId);
  if (held !== undefined && now - held < STALE_MS) return null;
  map.set(userId, now);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (map.get(userId) === now) map.delete(userId);
  };
}
