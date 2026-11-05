import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import { assertFts5Available, runMigrations } from './migrate';
import { session, user } from './schema';

const dirs: string[] = [];
const open: Db[] = [];
afterEach(() => {
  open.splice(0).forEach((d) => d.$client.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const track = (db: Db) => (open.push(db), db);
const tmp = () => (dirs.push(mkdtempSync(join(tmpdir(), 'rb-'))), dirs[dirs.length - 1]);

const names = (db: Db) =>
  (
    db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'",
      )
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .sort();

describe('migrations', () => {
  it('creates the DB file (and parent dir) and applies the v0.1 and recipe tables', () => {
    const path = join(tmp(), 'nested', 'app.db');
    const db = track(openDb(path));
    runMigrations(db);
    expect(existsSync(path)).toBe(true);
    expect(names(db)).toEqual([
      'ingredient',
      'invite',
      'password_reset',
      'recipe',
      'section',
      'session',
      'step',
      'user',
    ]);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('is idempotent across restarts', () => {
    const path = join(tmp(), 'app.db');
    runMigrations(track(openDb(path)));
    const db2 = track(openDb(path));
    expect(() => runMigrations(db2)).not.toThrow();
    const n = db2.$client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {
      n: number;
    };
    expect(n.n).toBe(3);
  });

  it('enforces uniqueness, defaults, ULID ids and FK cascade', () => {
    const db = track(openDb(':memory:'));
    runMigrations(db);
    const base = { email: 'a@x.test', displayName: 'A', passwordHash: 'h', role: 'admin' as const };
    const [u] = db.insert(user).values(base).returning().all();
    expect(u.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(u.unitPref).toBe('metric');
    expect(u.locale).toBe('en');
    expect(u.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(u.deactivatedAt).toBeNull();
    expect(() => db.insert(user).values(base).run()).toThrow(/UNIQUE/);
    expect(() =>
      db.insert(session).values({ id: 's', userId: 'missing', expiresAt: u.createdAt }).run(),
    ).toThrow(/FOREIGN KEY/);
    db.insert(session).values({ id: 's', userId: u.id, expiresAt: u.createdAt }).run();
    db.delete(user).where(eq(user.id, u.id)).run();
    expect(db.select().from(session).all()).toHaveLength(0);
  });
});

describe('FTS5', () => {
  it('is available and leaves no table behind', () => {
    const db = track(openDb(':memory:'));
    expect(() => assertFts5Available(db)).not.toThrow();
    expect(names(db)).toEqual([]);
  });
});
