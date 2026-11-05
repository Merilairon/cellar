import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { session, user } from '@/lib/db/schema';
import { deactivateUser, listUsersForAdmin } from './admin';
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
