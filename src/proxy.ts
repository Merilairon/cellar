import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { isPublicPath } from '@/lib/auth/routes';
import { generateNonce, securityHeaders } from '@/lib/security/headers';

/**
 * Next 16.4.5 file convention: `proxy.ts` (`middleware.ts` is deprecated, same API).
 * Edge-safe on purpose: Web APIs only, no db, argon2 or node:* imports (ESLint-enforced).
 *
 * Two jobs:
 * 1. Cheap first gate: a request without a session cookie never reaches a page. A forged
 *    cookie passes here and is stopped by full validation in server code (getCurrentUser /
 *    requireAdmin: session row, expiry, deactivated user, admin role).
 * 2. Security headers (CSP with per-request nonce, nosniff, frame-ancestors, Referrer-Policy,
 *    X-Frame-Options legacy mirror; no HSTS) on every response, including redirects and 401s.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = generateNonce();
  const sec = securityHeaders({
    nonce,
    https: (process.env.BASE_URL ?? '').startsWith('https://'),
    dev: process.env.NODE_ENV !== 'production',
  });
  const withHeaders = (res: NextResponse) => {
    for (const [k, v] of Object.entries(sec)) res.headers.set(k, v);
    return res;
  };

  if (isPublicPath(pathname) || request.cookies.has(SESSION_COOKIE)) {
    // Next picks the nonce up from the request CSP header and applies it to its scripts.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('Content-Security-Policy', sec['Content-Security-Policy']);
    requestHeaders.set('x-nonce', nonce);
    return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  if (pathname.startsWith('/api/')) {
    return withHeaders(NextResponse.json({ error: 'unauthenticated' }, { status: 401 }));
  }
  // BASE_URL, not request.url: behind a reverse proxy the latter is the internal host.
  const base = process.env.BASE_URL || request.url;
  return withHeaders(NextResponse.redirect(new URL('/login', base)));
}

export const config = {
  // Static assets bypass the proxy entirely; everything else is gated by isPublicPath.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
