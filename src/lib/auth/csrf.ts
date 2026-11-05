const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF check for mutating requests (authoritative; call from every mutating handler).
 * Strategy: Origin / Sec-Fetch-Site against BASE_URL, on top of SameSite=Lax.
 * - Sec-Fetch-Site, when present, must be "same-origin".
 * - Origin, when present, must equal BASE_URL's origin.
 * - At least one of the two must be present; otherwise there is no proof.
 */
export function isCsrfSafe(
  method: string,
  headers: { get(name: string): string | null },
  baseUrl: string,
): boolean {
  if (SAFE.has(method.toUpperCase())) return true;
  const site = headers.get('sec-fetch-site');
  const origin = headers.get('origin');
  if (site !== null && site !== 'same-origin') return false;
  if (origin !== null && origin !== new URL(baseUrl).origin) return false;
  return site !== null || origin !== null;
}
