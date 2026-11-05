import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { invite, passwordReset, session, user } from '@/lib/db/schema';
import { deactivateUser, deleteUser, listUsersForAdmin } from './admin';
import { deleteUserSchema } from './schemas';
import { createSession, validateSession } from './session';

let db: Db;
const mk = (email: string, role: 'admin' | 'member') =>
  db.insert(user).values({ email, displayName: email, passwordHash: 'h', role }).returning().get();
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
};
afterEach(() => db.$client.close());

describe('admin operations', () => {
  it('lists users with status', () => {
    setup();
    mk('a@x.test', 'admin');
    expect(listUsersForAdmin(db)).toMatchObject([
      { email: 'a@x.test', role: 'admin', active: true },
    ]);
  });

  it('deactivation marks the user and invalidates all their sessions', () => {
    setup();
    mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const { token } = createSession(db, m.id);
    createSession(db, m.id);
    expect(deactivateUser(db, m.id)).toBe('ok');
    expect(validateSession(db, token)).toBeNull();
    expect(db.select().from(session).all()).toHaveLength(0);
    expect(deactivateUser(db, m.id)).toBe('already_deactivated');
    expect(deactivateUser(db, 'nope')).toBe('not_found');
  });

  it('refuses to deactivate the last active admin, even themselves', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const { token } = createSession(db, a.id);
    expect(deactivateUser(db, a.id)).toBe('last_admin');
    expect(validateSession(db, token)?.id).toBe(a.id);
  });

  it('allows deactivating an admin while another active admin exists; deactivated admins do not count', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const b = mk('b@x.test', 'admin');
    expect(deactivateUser(db, a.id)).toBe('ok');
    expect(deactivateUser(db, b.id)).toBe('last_admin');
  });
});

describe('deleteUser', () => {
  it('deletes a member, cascading sessions, invites and resets', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const { token } = createSession(db, m.id);
    db.insert(invite)
      .values({ tokenHash: 'i', createdBy: m.id, expiresAt: new Date().toISOString() })
      .run();
    db.insert(passwordReset)
      .values({ userId: m.id, tokenHash: 'r', createdBy: a.id, expiresAt: 'x' })
      .run();
    expect(deleteUser(db, m.id, { recipes: 'delete' })).toBe('ok');
    expect(validateSession(db, token)).toBeNull();
    expect(db.select().from(user).all()).toHaveLength(1);
    expect(db.select().from(invite).all()).toHaveLength(0);
    expect(db.select().from(passwordReset).all()).toHaveLength(0);
    expect(deleteUser(db, m.id, { recipes: 'delete' })).toBe('not_found');
  });

  it('keeps a reset created by a deleted admin, with created_by null', () => {
    setup();
    mk('a@x.test', 'admin');
    const b = mk('b@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    db.insert(passwordReset)
      .values({ userId: m.id, tokenHash: 'r', createdBy: b.id, expiresAt: 'x' })
      .run();
    expect(deleteUser(db, b.id, { recipes: 'delete' })).toBe('ok');
    expect(db.select().from(passwordReset).get()?.createdBy).toBeNull();
  });

  it('refuses the last active admin, including self; allows when another admin exists', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    mk('m@x.test', 'member');
    expect(deleteUser(db, a.id, { recipes: 'delete' })).toBe('last_admin');
    const b = mk('b@x.test', 'admin');
    expect(deleteUser(db, a.id, { recipes: 'reassign', reassignTo: b.id })).toBe('ok');
    expect(deleteUser(db, b.id, { recipes: 'delete' })).toBe('last_admin');
  });

  it('refuses invalid reassign targets and deletes nothing', () => {
    setup();
    mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const d = mk('d@x.test', 'member');
    deactivateUser(db, d.id);
    for (const reassignTo of ['nope', d.id, m.id]) {
      expect(deleteUser(db, m.id, { recipes: 'reassign', reassignTo })).toBe(
        'invalid_reassign_target',
      );
    }
    expect(db.select().from(user).all()).toHaveLength(3);
  });
});

describe('deleteUserSchema', () => {
  it('requires the choice, and reassignTo only for reassign', () => {
    expect(deleteUserSchema.safeParse({ userId: 'u' }).success).toBe(false);
    expect(deleteUserSchema.safeParse({ userId: 'u', recipes: 'keep' }).success).toBe(false);
    expect(deleteUserSchema.safeParse({ userId: 'u', recipes: 'reassign' }).success).toBe(false);
    expect(deleteUserSchema.safeParse({ userId: 'u', recipes: 'delete' }).success).toBe(true);
    expect(
      deleteUserSchema.safeParse({ userId: 'u', recipes: 'reassign', reassignTo: 'v' }).success,
    ).toBe(true);
  });
});
