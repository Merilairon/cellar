import { cpSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import { assertFts5Available, runMigrations } from './migrate';
import { session, user } from './schema';
import { getRecipeFull } from './recipes';
import { toApiRecipe } from '@/lib/recipes/service';

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

describe('migration 0002 (qty_max) on existing data', () => {
  it('keeps rows created under 0001, with null upper bounds, readable through the API mapper', () => {
    const src = join(process.cwd(), 'drizzle');
    const old = join(tmp(), 'drizzle');
    cpSync(src, old, { recursive: true });
    const journalPath = join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 2); // 0000 + 0001 only
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = track(openDb(join(tmp(), 'app.db')));
    runMigrations(db, old);
    db.$client
      .prepare(
        "INSERT INTO user (id,email,display_name,password_hash,role,created_at) VALUES ('u1','u@x.test','U','h','member','2026-01-01')",
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO recipe (id,owner_id,title,created_at,updated_at) VALUES ('r1','u1','Old','2026-01-01','2026-01-01')",
      )
      .run();
    db.$client.prepare("INSERT INTO section (id,recipe_id,position) VALUES ('s1','r1',0)").run();
    db.$client
      .prepare(
        "INSERT INTO ingredient (id,recipe_id,section_id,position,name,raw_text,us_qty,us_unit,display_primary) VALUES ('i1','r1','s1',0,'honey','2-3 tbsp honey',2,'tbsp','us')",
      )
      .run();

    runMigrations(db); // applies 0002
    const full = getRecipeFull(db, 'r1')!;
    expect(full.sections[0]!.ingredients[0]).toMatchObject({
      usQty: 2,
      usQtyMax: null,
      metricQtyMax: null,
    });
    const api = toApiRecipe(full, true);
    expect(api.sections[0]!.ingredients[0]).toMatchObject({
      us_qty: 2,
      us_qty_max: null,
      metric_qty_max: null,
    });
  });
});

describe('migrations', () => {
  it('creates the DB file (and parent dir) and applies the v0.1 and recipe tables', () => {
    const path = join(tmp(), 'nested', 'app.db');
    const db = track(openDb(path));
    runMigrations(db);
    expect(existsSync(path)).toBe(true);
    expect(names(db)).toEqual([
      'import_job',
      'ingredient',
      'invite',
      'password_reset',
      'photo',
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
    expect(n.n).toBe(5);
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
