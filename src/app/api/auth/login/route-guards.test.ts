import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { user } from '@/lib/db/schema';

// v1.0 security review M2: controls in the login route whose removal failed no test. The real
// PASSWORD_MAX and the real CSRF check are used here on purpose (route.test.ts mocks the password
// module); only the expensive hashing calls are spies.

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  verify: vi.fn(async (_h: string, p: string) => p === 'correct-password-1'),
  dummy: vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined),
  cookie: vi.fn(async () => undefined),
  session: vi.fn(() => ({ token: 't', expiresAt: new Date() })),
}));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    BASE_URL: 'http://localhost:3100',
    RATE_LIMIT_LOGIN_MAX: 50,
    RATE_LIMIT_LOGIN_EMAIL_MAX: 50,
    RATE_LIMIT_LOGIN_WINDOW_SEC: 900,
    TRUSTED_PROXIES: [],
  }),
}));
vi.mock('@/lib/auth/password', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/password')>()),
  verifyPassword: state.verify,
  verifyDummy: state.dummy,
}));
vi.mock('@/lib/auth/cookies', () => ({ setSessionCookie: state.cookie }));
vi.mock('@/lib/auth/session', () => ({ createSession: state.session }));
vi.mock('@/lib/log', () => ({ log: () => undefined }));

import { POST } from './route';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  vi.clearAllMocks();
  (globalThis as { __rateLimiters?: unknown }).__rateLimiters = undefined;
  db.insert(user)
    .values({ email: 'real@x.test', displayName: 'r', passwordHash: 'h', role: 'member' })
    .run();
  db.insert(user)
    .values({
      email: 'gone@x.test',
      displayName: 'g',
      passwordHash: 'h',
      role: 'member',
      deactivatedAt: new Date().toISOString(),
    })
    .run();
});
afterEach(() => db.$client.close());

const login = (email: string, password: string, origin: string | null = 'http://localhost:3100') =>
  POST(
    new Request('http://localhost:3100/api/auth/login', {
      method: 'POST',
      headers: origin ? { origin } : {},
      body: new URLSearchParams({ email, password }),
    }),
  );

describe('login route guards', () => {
  it('an unknown email still pays the hash cost (timing equalizer)', async () => {
    const res = await login('nobody@x.test', 'whatever-password-1');
    expect(res.headers.get('location')).toContain('error=invalid');
    expect(state.dummy).toHaveBeenCalledTimes(1);
    expect(state.dummy).toHaveBeenCalledWith('whatever-password-1');
    expect(state.verify).not.toHaveBeenCalled();
  });

  it('a known email does the real verify and not the dummy', async () => {
    await login('real@x.test', 'wrong-password-123');
    expect(state.verify).toHaveBeenCalledTimes(1);
    expect(state.dummy).not.toHaveBeenCalled();
  });

  it('a password over PASSWORD_MAX is rejected before any hashing', async () => {
    const res = await login('real@x.test', 'a'.repeat(129));
    expect(res.headers.get('location')).toContain('error=invalid');
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.dummy).not.toHaveBeenCalled();
    expect(state.cookie).not.toHaveBeenCalled();
  });

  it('a cross-origin login POST is 403 and sets no cookie (login CSRF)', async () => {
    const res = await login('real@x.test', 'correct-password-1', 'http://evil.example');
    expect(res.status).toBe(403);
    expect(state.cookie).not.toHaveBeenCalled();
    expect(state.session).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
  });

  it('a login POST with no Origin and no Sec-Fetch-Site is 403', async () => {
    const res = await login('real@x.test', 'correct-password-1', null);
    expect(res.status).toBe(403);
    expect(state.cookie).not.toHaveBeenCalled();
  });

  it('a deactivated user with the right password gets no session or cookie', async () => {
    const res = await login('gone@x.test', 'correct-password-1');
    expect(res.headers.get('location')).toContain('error=invalid');
    expect(state.verify).toHaveBeenCalledTimes(1);
    expect(state.session).not.toHaveBeenCalled();
    expect(state.cookie).not.toHaveBeenCalled();
  });

  it('control: the same right password for an active user signs in', async () => {
    const res = await login('real@x.test', 'correct-password-1');
    expect(res.headers.get('location')).toBe('http://localhost:3100/');
    expect(state.cookie).toHaveBeenCalledTimes(1);
  });
});
