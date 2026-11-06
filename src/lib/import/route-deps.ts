import { getEnv } from '@/lib/env';
import { createHeadless, type Headless } from './headless-client';
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

/**
 * Headless handle from env alone (HEADLESS_URL is operator config, never request data).
 * Disabled and inert when HEADLESS_URL is unset: no sidecar request is ever made.
 */
export function serverHeadless(): Headless {
  const e = getEnv();
  return createHeadless(
    e.HEADLESS_URL
      ? { url: e.HEADLESS_URL, token: e.HEADLESS_TOKEN, timeoutMs: e.HEADLESS_TIMEOUT_MS }
      : null,
    { allowLocal: e.IMPORT_ALLOW_LOCAL_FETCH, log: importLog },
  );
}
