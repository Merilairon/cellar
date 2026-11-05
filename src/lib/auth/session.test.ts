import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { session, user } from '@/lib/db/schema';
import {
  cleanupExpiredSessions,
  createSession,
  deleteSession,
  hashToken,
  SESSION_TTL_MS,
  validateSession,
} from './session';

let db: Db;
let uid: string;
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  uid = db
    .insert(user)
    .values({ email: 'a@x.test', displayName: 'A', passwordHash: 'h', role: 'member' })
    .returning()
    .get().id;
};
afterEach(() => db.$client.close());

describe('sessions', () => {
  it('stores only the SHA-256 of the token and validates it', () => {
    setup();
    const { token } = createSession(db, uid);
    const rows = db.select().from(session).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashToken(token));
    expect(rows[0].id).not.toBe(token);
    expect(validateSession(db, token)?.id).toBe(uid);
    expect(validateSession(db, 'bogus')).toBeNull();
  });
  it('rejects and removes an expired session', () => {
    setup();
    const now = new Date('2026-01-01T00:00:00Z');
    const { token } = createSession(db, uid, now);
    const justBefore = new Date(now.getTime() + SESSION_TTL_MS - 1);
    expect(validateSession(db, token, justBefore)).not.toBeNull();
    expect(validateSession(db, token, new Date(now.getTime() + SESSION_TTL_MS))).toBeNull();
    expect(db.select().from(session).all()).toHaveLength(0);
  });
  it('delete invalidates the token; cleanup drops expired rows', () => {
    setup();
    const a = createSession(db, uid);
    deleteSession(db, a.token);
    expect(validateSession(db, a.token)).toBeNull();
    createSession(db, uid, new Date('2020-01-01T00:00:00Z'));
    createSession(db, uid);
    expect(cleanupExpiredSessions(db)).toBe(1);
    expect(db.select().from(session).all()).toHaveLength(1);
  });
  it('rejects a deactivated user', () => {
    setup();
    const { token } = createSession(db, uid);
    db.update(user).set({ deactivatedAt: new Date().toISOString() }).run();
    expect(validateSession(db, token)).toBeNull();
  });
});
