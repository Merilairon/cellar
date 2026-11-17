import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { user } from '@/lib/db/schema';

const state = vi.hoisted(() => ({ db: undefined as unknown, logs: [] as unknown[][] }));
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
vi.mock('@/lib/auth/password', () => ({
  PASSWORD_MIN: 12,
  PASSWORD_MAX: 128,
  verifyPassword: async (_h: string, p: string) => p === 'correct-password-1',
  verifyDummy: async () => undefined,
}));
vi.mock('@/lib/auth/cookies', () => ({ setSessionCookie: async () => undefined }));
vi.mock('@/lib/auth/session', () => ({
  createSession: () => ({ token: 't', expiresAt: new Date() }),
}));
vi.mock('@/lib/log', () => ({
  log: (...a: unknown[]) => state.logs.push(a),
}));

import { POST } from './route';

let db: Db;
let uid: string;
beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  state.logs = [];
  (globalThis as { __rateLimiters?: unknown }).__rateLimiters = undefined;
  uid = db
    .insert(user)
    .values({ email: 'real@x.test', displayName: 'r', passwordHash: 'h', role: 'member' })
    .returning()
    .get().id;
});
afterEach(() => db.$client.close());

const login = (email: string, password: string) =>
  POST(
    new Request('http://localhost:3100/api/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:3100' },
      body: new URLSearchParams({ email, password }),
    }),
  );

describe('auth.login_failed', () => {
  it('logs the user id for a wrong password, never the email', async () => {
    const res = await login('real@x.test', 'wrong-password-123');
    expect(res.headers.get('location')).toContain('error=invalid');
    expect(state.logs).toEqual([['warn', 'auth.login_failed', { user_id: uid }]]);
    expect(JSON.stringify(state.logs)).not.toContain('real@x.test');
  });

  it('logs "unknown" for an unknown email, never the email', async () => {
    await login('nobody@x.test', 'whatever-password-1');
    expect(state.logs).toEqual([['warn', 'auth.login_failed', { user_id: 'unknown' }]]);
    expect(JSON.stringify(state.logs)).not.toContain('nobody');
  });

  it('a successful login logs no failure', async () => {
    const res = await login('real@x.test', 'correct-password-1');
    expect(res.headers.get('location')).toBe('http://localhost:3100/');
    expect(state.logs).toEqual([]);
  });
});
