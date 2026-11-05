import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { invite, user } from '@/lib/db/schema';
import { createInvite, INVITE_TTL_MS, lookupInvite, registerWithToken } from './invites';
import { hashToken } from './session';

let db: Db;
let adminId: string;
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  adminId = db
    .insert(user)
    .values({ email: 'admin@x.test', displayName: 'A', passwordHash: 'h', role: 'admin' })
    .returning()
    .get().id;
};
afterEach(() => db.$client.close());

const BASE = 'https://recipes.test';
const tokenOf = (link: string) => link.slice(`${BASE}/register/`.length);
const person = { displayName: 'Bob', password: 'a-long-enough-pass' };

describe('invites', () => {
  it('stores only the hash, never the plaintext token', () => {
    setup();
    const { link } = createInvite(db, { createdBy: adminId, baseUrl: BASE });
    const token = tokenOf(link);
    expect(link.startsWith(`${BASE}/register/`)).toBe(true);
    const rows = db.select().from(invite).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('expires after the TTL', () => {
    setup();
    const now = new Date('2026-01-01T00:00:00Z');
    const { link, expiresAt } = createInvite(db, { createdBy: adminId, baseUrl: BASE }, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    const token = tokenOf(link);
    expect(lookupInvite(db, token, new Date(expiresAt.getTime() - 1))).toBeDefined();
    expect(lookupInvite(db, token, expiresAt)).toBeUndefined();
  });

  it('registers once with a valid token, then rejects reuse', async () => {
    setup();
    const token = tokenOf(createInvite(db, { createdBy: adminId, baseUrl: BASE }).link);
    const first = await registerWithToken(db, token, { ...person, email: 'Bob@X.test' });
    expect(first.ok && first.user.role).toBe('member');
    expect(first.ok && first.user.email).toBe('bob@x.test');
    const second = await registerWithToken(db, token, { ...person, email: 'c@x.test' });
    expect(second).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects expired and tampered tokens', async () => {
    setup();
    const now = new Date('2026-01-01T00:00:00Z');
    const token = tokenOf(createInvite(db, { createdBy: adminId, baseUrl: BASE }, now).link);
    const late = new Date(now.getTime() + INVITE_TTL_MS);
    expect(await registerWithToken(db, token, { ...person, email: 'b@x.test' }, late)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await registerWithToken(db, token + 'x', { ...person, email: 'b@x.test' }, now)).toEqual(
      { ok: false, reason: 'invalid' },
    );
  });

  it('pins the invite email, requires one otherwise, and reports duplicates without consuming', async () => {
    setup();
    const pinned = tokenOf(
      createInvite(db, { createdBy: adminId, baseUrl: BASE, email: 'Pin@x.test' }).link,
    );
    const r = await registerWithToken(db, pinned, { ...person, email: 'other@x.test' });
    expect(r.ok && r.user.email).toBe('pin@x.test');

    const open = tokenOf(createInvite(db, { createdBy: adminId, baseUrl: BASE }).link);
    expect(await registerWithToken(db, open, person)).toEqual({
      ok: false,
      reason: 'email_required',
    });
    expect(await registerWithToken(db, open, { ...person, email: 'admin@x.test' })).toEqual({
      ok: false,
      reason: 'email_taken',
    });
    expect(lookupInvite(db, open)).toBeDefined(); // still usable after validation failures
  });

  it('concurrent submits of one token create exactly one user', async () => {
    setup();
    const token = tokenOf(createInvite(db, { createdBy: adminId, baseUrl: BASE }).link);
    const results = await Promise.all(
      ['1', '2', '3'].map((n) =>
        registerWithToken(db, token, { ...person, email: `u${n}@x.test` }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(db.select().from(user).all()).toHaveLength(2);
  });
});
