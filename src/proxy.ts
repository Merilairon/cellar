import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { isPublicPath } from '@/lib/auth/routes';
import { generateNonce, securityHeaders } from '@/lib/security/headers';
import {
  isPublicSharePath,
  PUBLIC_RATE_LIMITED_BODY,
  publicRateLimit,
} from '@/lib/security/public-limit';

/**
 * Next 16.4.5 file convention: `proxy.ts` (`middleware.ts` is deprecated, same API).
 * Runs on the Node.js runtime (Next 16 default), in the same process as the routes. Keep it
 * light anyway: no db or argon2 (ESLint-enforced), and no direct node:* imports; the public
 * limiter reaches `node:net` only through the client-IP helpers.
 *
 * Two jobs:
 * 1. Cheap first gate: a request without a session cookie never reaches a page. A forged
 *    cookie passes here and is stopped by full validation in server code (getCurrentUser /
 *    requireAdmin: session row, expiry, deactivated user, admin role).
 * 2. Security headers (CSP with per-request nonce, nosniff, frame-ancestors, Referrer-Policy,
 *    X-Frame-Options legacy mirror; no HSTS) on every response, including redirects and 401s.
 * 3. `/r/*` (public share links): `Referrer-Policy: no-referrer` instead of `same-origin`, so
 *    the secret token in the URL never leaves in a Referer header, and a per-IP rate limit
 *    (429 with Retry-After; a page cannot return 429, so it lives here).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = generateNonce();
  const sec = securityHeaders({
    nonce,
    https: (process.env.BASE_URL ?? '').startsWith('https://'),
    dev: process.env.NODE_ENV !== 'production',
  });
  const sharePath = isPublicSharePath(pathname);
  if (sharePath) sec['Referrer-Policy'] = 'no-referrer';
  const withHeaders = (res: NextResponse) => {
    for (const [k, v] of Object.entries(sec)) res.headers.set(k, v);
    return res;
  };

  if (sharePath) {
    const retryAfter = publicRateLimit(request.headers);
    if (retryAfter !== null) {
      return withHeaders(
        new NextResponse(PUBLIC_RATE_LIMITED_BODY, {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        }),
      );
    }
  }

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
  // `/api/import/backup` (staged restore upload, up to RESTORE_BODY_MAX) is excluded too: a
  // matched request has its body buffered in memory and silently truncated at
  // `proxyClientMaxBodySize` (11 MiB, see next.config.ts), which would turn every larger
  // backup into a corrupt file, and raising that limit would make every route buffer that much.
  // The route authenticates itself (CSRF, session) and answers JSON that is never cached.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/import/backup(?:/|$)).*)'],
};
