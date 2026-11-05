/**
 * Public-path allow-list for the proxy gate. Edge-safe: no node:*, db or native imports.
 * Exact paths match only themselves; prefixes match only strictly below them
 * ("/register/x" yes, "/register", "/registerx", "/login-foo", "/setup/../admin" no).
 */
const PUBLIC_EXACT = new Set([
  '/login',
  '/setup',
  '/api/health',
  '/api/setup',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/reset',
]);
const PUBLIC_PREFIXES = ['/register/', '/reset/', '/r/', '/_next/'];

export function isPublicPath(pathname: string): boolean {
  if (pathname.includes('..') || pathname.includes('//') || pathname.includes('\\')) return false;
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p) && pathname.length > p.length);
}
