/**
 * Security header builder. Edge-safe (pure strings, no node:* imports): used by src/proxy.ts.
 *
 * CSP strategy: per-request nonce + 'strict-dynamic'. Next 16 reads the nonce from the request's
 * Content-Security-Policy header and stamps it on its own scripts; this requires dynamic
 * rendering, which holds because the root layout reads cookies() (theme, locale). The theme is
 * a cookie rendered server-side, so no inline script is needed. Styles allow 'unsafe-inline'
 * because React/Next emit inline style attributes; scripts, which matter for XSS, stay strict.
 */

export interface HeaderOptions {
  nonce: string;
  /** BASE_URL starts with https:// */
  https: boolean;
  dev?: boolean;
}

export function buildCsp({ nonce, https, dev = false }: HeaderOptions): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function securityHeaders(opts: HeaderOptions): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': buildCsp(opts),
    'X-Content-Type-Options': 'nosniff',
    // Legacy mirror of CSP frame-ancestors 'none' for browsers without CSP2; harmless.
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  };
  // No HSTS on purpose: a wrong max-age pins browsers to HTTPS for a host the owner may serve
  // over HTTP (LAN, localhost). Add it at the reverse proxy if wanted (see README).
  return h;
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
