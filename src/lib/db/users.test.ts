import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import { countUsers, createFirstAdmin, getUserById, setUnitPref } from './users';

let db: Db;
afterEach(() => db.$client.close());
const fresh = () => ((db = openDb(':memory:')), runMigrations(db), db);
const input = (email: string) => ({ email, displayName: 'A', passwordHash: 'h' });

describe('createFirstAdmin', () => {
  it('creates an admin when empty and refuses afterwards (setup guard)', () => {
    fresh();
    const u = createFirstAdmin(db, input('A@X.test'));
    expect(u?.role).toBe('admin');
    expect(u?.email).toBe('a@x.test');
    expect(createFirstAdmin(db, input('b@x.test'))).toBeUndefined();
    expect(countUsers(db)).toBe(1);
  });
});

describe('setUnitPref', () => {
  it('updates unit_pref for an existing user only', () => {
    fresh();
    const u = createFirstAdmin(db, input('a@x.test'))!;
    expect(u.unitPref).toBe('metric');
    expect(setUnitPref(db, u.id, 'us')).toBe(true);
    expect(getUserById(db, u.id)?.unitPref).toBe('us');
    expect(setUnitPref(db, 'missing', 'metric')).toBe(false);
  });
});
