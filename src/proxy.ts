import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { isPublicPath } from '@/lib/auth/routes';

/**
 * Next 16.4.5 file convention: `proxy.ts` (`middleware.ts` is deprecated, same API).
 * Edge-safe on purpose: Web APIs only, no db, argon2 or node:* imports (ESLint-enforced).
 *
 * This is only the cheap first gate: a request without a session cookie never reaches a
 * page. A forged cookie passes here and is stopped by full validation in server code
 * (getCurrentUser / requireAdmin: session row, expiry, deactivated user, admin role).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname) || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  // BASE_URL, not request.url: behind a reverse proxy the latter is the internal host.
  const base = process.env.BASE_URL || request.url;
  return NextResponse.redirect(new URL('/login', base));
}

export const config = {
  // Static assets bypass the proxy entirely; everything else is gated by isPublicPath.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
