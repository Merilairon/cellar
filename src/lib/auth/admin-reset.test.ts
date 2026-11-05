import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { passwordReset, session, user } from '@/lib/db/schema';
import { adminResetByEmail, runAdminReset } from './admin-reset';
import { isResetTokenUsable, resetPasswordWithToken } from './resets';
import { createSession } from './session';

let db: Db;
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
};
const mk = (email: string, deactivatedAt: string | null = null) =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role: 'admin', deactivatedAt })
    .returning()
    .get();
afterEach(() => db.$client.close());

const BASE = 'http://localhost:3000';

describe('adminResetByEmail', () => {
  it('issues a hashed, expiring, single-use link with created_by null', async () => {
    setup();
    const u = mk('a@x.test');
    createSession(db, u.id);
    const res = adminResetByEmail(db, ' A@X.test ', BASE);
    if (!res.ok) throw new Error('expected ok');
    const token = res.link.replace(`${BASE}/reset/`, '');
    const row = db.select().from(passwordReset).get()!;
    expect(row.createdBy).toBeNull();
    expect(row.userId).toBe(u.id);
    expect(row.tokenHash).not.toContain(token);
    expect(isResetTokenUsable(db, token)).toBe(true);
    expect(await resetPasswordWithToken(db, token, 'a-brand-new-password')).toBe(true);
    expect(await resetPasswordWithToken(db, token, 'another-password-12')).toBe(false);
    expect(db.select().from(session).all()).toHaveLength(0);
  });

  it('refuses unknown and deactivated users without creating a token', () => {
    setup();
    mk('gone@x.test', new Date().toISOString());
    expect(adminResetByEmail(db, 'nobody@x.test', BASE)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(adminResetByEmail(db, 'gone@x.test', BASE)).toEqual({
      ok: false,
      reason: 'deactivated',
    });
    expect(adminResetByEmail(db, '  ', BASE)).toEqual({ ok: false, reason: 'invalid_email' });
    expect(db.select().from(passwordReset).all()).toHaveLength(0);
  });
});

describe('runAdminReset exit codes', () => {
  const io = () => {
    const o = { logs: [] as string[], errs: [] as string[] };
    return {
      o,
      out: { log: (s: string) => o.logs.push(s), error: (s: string) => o.errs.push(s) },
    };
  };

  it('0 and prints the link on success', () => {
    setup();
    mk('a@x.test');
    const { o, out } = io();
    expect(runAdminReset(db, ['a@x.test'], BASE, out)).toBe(0);
    expect(o.logs[0]).toMatch(/^http:\/\/localhost:3000\/reset\/.+/);
  });

  it('1 for unknown email, 2 for missing argument', () => {
    setup();
    const { o, out } = io();
    expect(runAdminReset(db, ['x@x.test'], BASE, out)).toBe(1);
    expect(runAdminReset(db, [], BASE, out)).toBe(2);
    expect(o.logs).toHaveLength(0);
    expect(db.select().from(passwordReset).all()).toHaveLength(0);
  });
});
