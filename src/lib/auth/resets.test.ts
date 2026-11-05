import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { passwordReset, session, user } from '@/lib/db/schema';
import { verifyPassword } from './password';
import {
  isResetTokenUsable,
  issuePasswordReset,
  RESET_TTL_MS,
  resetPasswordWithToken,
} from './resets';
import { createSession, hashToken } from './session';

let db: Db;
let uid: string;
const BASE = 'https://recipes.test';
const tokenOf = (link: string) => link.slice(`${BASE}/reset/`.length);
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  uid = db
    .insert(user)
    .values({ email: 'm@x.test', displayName: 'M', passwordHash: 'old', role: 'member' })
    .returning()
    .get().id;
};
afterEach(() => db.$client.close());

describe('password resets', () => {
  it('issues a hashed, expiring token and refuses deactivated users', () => {
    setup();
    const now = new Date('2026-01-01T00:00:00Z');
    const res = issuePasswordReset(db, { userId: uid, createdBy: null, baseUrl: BASE }, now)!;
    const token = tokenOf(res.link);
    const rows = db.select().from(passwordReset).all();
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(res.expiresAt.getTime() - now.getTime()).toBe(RESET_TTL_MS);
    expect(isResetTokenUsable(db, token, new Date(res.expiresAt.getTime() - 1))).toBe(true);
    expect(isResetTokenUsable(db, token, res.expiresAt)).toBe(false);
    db.update(user).set({ deactivatedAt: now.toISOString() }).run();
    expect(issuePasswordReset(db, { userId: uid, createdBy: null, baseUrl: BASE })).toBeUndefined();
  });

  it('is single-use, sets the password and revokes sessions', async () => {
    setup();
    const token = tokenOf(
      issuePasswordReset(db, { userId: uid, createdBy: null, baseUrl: BASE })!.link,
    );
    createSession(db, uid);
    expect(await resetPasswordWithToken(db, token, 'brand-new-password')).toBe(true);
    const hash = db.select().from(user).get()!.passwordHash;
    expect(await verifyPassword(hash, 'brand-new-password')).toBe(true);
    expect(db.select().from(session).all()).toHaveLength(0);
    expect(await resetPasswordWithToken(db, token, 'another-password-1')).toBe(false);
    expect(db.select().from(user).get()!.passwordHash).toBe(hash);
  });

  it('rejects expired and tampered tokens; a newer link voids the older one', async () => {
    setup();
    const now = new Date('2026-01-01T00:00:00Z');
    const first = tokenOf(
      issuePasswordReset(db, { userId: uid, createdBy: null, baseUrl: BASE }, now)!.link,
    );
    expect(await resetPasswordWithToken(db, first + 'x', 'brand-new-password', now)).toBe(false);
    const late = new Date(now.getTime() + RESET_TTL_MS);
    expect(await resetPasswordWithToken(db, first, 'brand-new-password', late)).toBe(false);
    issuePasswordReset(db, { userId: uid, createdBy: null, baseUrl: BASE }, now);
    expect(await resetPasswordWithToken(db, first, 'brand-new-password', now)).toBe(false);
  });

  it('concurrent consumes succeed exactly once', async () => {
    setup();
    const token = tokenOf(
      issuePasswordReset(db, { userId: uid, createdBy: null, baseUrl: BASE })!.link,
    );
    const r = await Promise.all(
      ['aaaaaaaaaaaa1', 'bbbbbbbbbbbb2', 'cccccccccccc3'].map((p) =>
        resetPasswordWithToken(db, token, p),
      ),
    );
    expect(r.filter(Boolean)).toHaveLength(1);
  });
});
