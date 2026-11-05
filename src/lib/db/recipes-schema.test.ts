import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import { ingredient, recipe, section, step, user } from './schema';

let db: Db;
afterEach(() => db.$client.close());
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  return db
    .insert(user)
    .values({ email: 'a@x.test', displayName: 'A', passwordHash: 'h', role: 'member' })
    .returning()
    .get();
};
const mkRecipe = (ownerId: string, extra: Partial<typeof recipe.$inferInsert> = {}) =>
  db
    .insert(recipe)
    .values({ ownerId, title: 'R', ...extra })
    .returning()
    .get();

describe('recipe tables', () => {
  it('applies defaults: private, list view, ULID ids, timestamps', () => {
    const u = setup();
    const r = mkRecipe(u.id);
    expect(r.visibility).toBe('private');
    expect(r.viewMode).toBe('list');
    expect(r.shareToken).toBeNull();
    expect(r.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(r.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });

  it('cascades recipe -> section -> ingredient/step', () => {
    const u = setup();
    const r = mkRecipe(u.id);
    const s = db.insert(section).values({ recipeId: r.id, position: 0 }).returning().get();
    db.insert(ingredient)
      .values({ recipeId: r.id, sectionId: s.id, position: 0, name: 'x', rawText: 'x' })
      .run();
    db.insert(step)
      .values({
        recipeId: r.id,
        sectionId: s.id,
        position: 0,
        kind: 'column',
        label: 'l',
        rowStart: 0,
        rowEnd: 0,
      })
      .run();
    db.delete(recipe).where(eq(recipe.id, r.id)).run();
    expect(db.select().from(section).all()).toHaveLength(0);
    expect(db.select().from(ingredient).all()).toHaveLength(0);
    expect(db.select().from(step).all()).toHaveLength(0);
  });

  it('refuses to delete a user who owns recipes (RESTRICT)', () => {
    const u = setup();
    mkRecipe(u.id);
    expect(() => db.delete(user).where(eq(user.id, u.id)).run()).toThrow(/FOREIGN KEY/);
    expect(db.select().from(user).all()).toHaveLength(1);
  });

  it('sets copied_from_id to null when the source is deleted', () => {
    const u = setup();
    const a = mkRecipe(u.id);
    const b = mkRecipe(u.id, { copiedFromId: a.id });
    db.delete(recipe).where(eq(recipe.id, a.id)).run();
    expect(db.select().from(recipe).where(eq(recipe.id, b.id)).get()?.copiedFromId).toBeNull();
  });

  it('enforces unique positions, unique share_token and the span check', () => {
    const u = setup();
    const r = mkRecipe(u.id, { shareToken: 't' });
    expect(() => mkRecipe(u.id, { shareToken: 't' })).toThrow(/UNIQUE/);
    const s = db.insert(section).values({ recipeId: r.id, position: 0 }).returning().get();
    expect(() => db.insert(section).values({ recipeId: r.id, position: 0 }).run()).toThrow(
      /UNIQUE/,
    );
    const st = { recipeId: r.id, sectionId: s.id, kind: 'column' as const, label: 'l' };
    db.insert(step)
      .values({ ...st, position: 0, rowStart: 0, rowEnd: 2 })
      .run();
    expect(() =>
      db
        .insert(step)
        .values({ ...st, position: 0 })
        .run(),
    ).toThrow(/UNIQUE/);
    expect(() =>
      db
        .insert(step)
        .values({ ...st, position: 1, rowStart: 3, rowEnd: 1 })
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .insert(step)
        .values({ ...st, position: 2, rowStart: 1 })
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .insert(step)
        .values({ ...st, position: 3, rowStart: -1, rowEnd: 1 })
        .run(),
    ).toThrow(/CHECK/);
  });

  it('CHECKs enums and ties spans to kind', () => {
    const u = setup();
    const r = mkRecipe(u.id);
    const raw = (sql: string) => db.$client.exec(sql);
    expect(() => raw(`UPDATE recipe SET visibility='public' WHERE id='${r.id}'`)).toThrow(/CHECK/);
    expect(() => raw(`UPDATE recipe SET view_mode='cards' WHERE id='${r.id}'`)).toThrow(/CHECK/);
    const s = db.insert(section).values({ recipeId: r.id, position: 0 }).returning().get();
    const base = { recipeId: r.id, sectionId: s.id, label: 'l' };
    expect(() =>
      db
        .insert(step)
        .values({ ...base, position: 0, kind: 'banner_top', rowStart: 0, rowEnd: 0 })
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .insert(step)
        .values({ ...base, position: 1, kind: 'banner_bottom', rowStart: 1, rowEnd: 2 })
        .run(),
    ).toThrow(/CHECK/);
    db.insert(step)
      .values({ ...base, position: 2, kind: 'banner_top' })
      .run();
    db.insert(step)
      .values({ ...base, position: 3, kind: 'column' })
      .run(); // list-mode column without spans
    expect(() =>
      raw(
        `INSERT INTO step (id, recipe_id, section_id, position, kind, label) VALUES ('x','${r.id}','${s.id}',9,'sidebar','l')`,
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      raw(
        `INSERT INTO ingredient (id, recipe_id, section_id, position, name, raw_text, display_primary) VALUES ('y','${r.id}','${s.id}',0,'n','n','imperial')`,
      ),
    ).toThrow(/CHECK/);
  });

  it('keeps a v0.1 database intact when the recipe migration applies on top', () => {
    db = openDb(':memory:');
    const folder = join(process.cwd(), 'drizzle');
    // Apply only 0000 by copying journal entry 0 into a temp folder.
    const tmp = mkdtempSync(join(tmpdir(), 'rb-mig-'));
    try {
      cpSync(folder, tmp, { recursive: true });
      const journalPath = tmp + '/meta/_journal.json';
      const full = JSON.parse(readFileSync(journalPath, 'utf8'));
      writeFileSync(journalPath, JSON.stringify({ ...full, entries: full.entries.slice(0, 1) }));
      runMigrations(db, tmp);
      db.insert(user)
        .values({ email: 'old@x.test', displayName: 'Old', passwordHash: 'h', role: 'admin' })
        .run();
      runMigrations(db); // full set: adds the recipe tables, idempotent over 0000
      expect(db.select().from(user).all()).toHaveLength(1);
      expect(db.select().from(recipe).all()).toHaveLength(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
