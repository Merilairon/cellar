import { describe, expect, it } from 'vitest';
import { isPublicPath } from './routes';

describe('isPublicPath', () => {
  it.each([
    '/login',
    '/setup',
    '/register/abc',
    '/reset/abc',
    '/r/abc',
    '/api/health',
    '/api/auth/login',
    '/_next/static/x.js',
  ])('allows %s', (p) => expect(isPublicPath(p)).toBe(true));

  it.each([
    '/',
    '/admin/users',
    '/login-foo',
    '/login/',
    '/loginx',
    '/setup/../admin',
    '/setup/x',
    '/register',
    '/register/',
    '/registerx/abc',
    '/reset',
    '/r',
    '/api/health/x',
    '/api/admin/users',
    '/api/auth/logout',
    '/register//x',
    '/r/../admin',
    '/recipes',
  ])('blocks %s', (p) => expect(isPublicPath(p)).toBe(false));
});
