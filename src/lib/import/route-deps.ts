import { getEnv } from '@/lib/env';
import type { SafeFetchOptions } from './safe-fetch';

/**
 * The ONLY place fetch options are built. They derive from getEnv() alone; nothing from a
 * request reaches safeFetch (no allowLocal, resolver or transport from clients).
 */
export function serverFetchOptions(): SafeFetchOptions {
  const e = getEnv();
  return {
    allowLocal: e.IMPORT_ALLOW_LOCAL_FETCH,
    userAgent: `CellarBot/0.3 (+${e.BASE_URL})`,
  };
}

/** Server-side log: stable message plus the error text only, never page content. */
export function importLog(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err === undefined ? '' : 'non-error';
  console.warn(`[import] ${msg}${detail ? ` (${detail})` : ''}`);
}
