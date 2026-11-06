import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import {
  createImportJob,
  getImportJobForUser,
  markImportJobSaved,
  updateImportJob,
} from './import-jobs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { runMigrations, MIGRATIONS_FOLDER } from './migrate';
import { getCoverPhoto, insertCoverPhoto, listPhotoPathsByRecipe } from './photos';
import { findReadableRecipesBySourceUrl } from './recipes';
import { importJob, photo, recipe, user } from './schema';

let db: Db;
afterEach(() => db.$client.close());
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  const mk = (email: string) =>
    db
      .insert(user)
      .values({ email, displayName: email, passwordHash: 'h', role: 'member' })
      .returning()
      .get();
  return { a: mk('a@x.test'), b: mk('b@x.test') };
};
const mkRecipe = (ownerId: string, extra: Partial<typeof recipe.$inferInsert> = {}) =>
  db
    .insert(recipe)
    .values({ ownerId, title: 'R', ...extra })
    .returning()
    .get();

describe('migration 0003', () => {
  it('applies on an empty DB and is idempotent', () => {
    setup();
    expect(() => runMigrations(db)).not.toThrow();
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(['import_job', 'photo']));
  });

  it('applies on top of a v0.2 database (0000-0002) and keeps its data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      db = openDb(':memory:');
      // Apply only migrations up to 0002 by copying a trimmed folder.

      cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      const full = journal.entries;
      journal.entries = full.slice(0, 3);
      writeFileSync(journalPath, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      const u = db
        .insert(user)
        .values({ email: 'v@x.test', displayName: 'v', passwordHash: 'h', role: 'member' })
        .returning()
        .get();
      mkRecipe(u.id, { title: 'old', sourceUrl: 'https://old.example/x' });
      journal.entries = full;
      writeFileSync(journalPath, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      expect(
        db
          .select()
          .from(recipe)
          .all()
          .map((r) => r.title),
      ).toEqual(['old']);
      expect(db.select().from(importJob).all()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migration 0004 (headless_unavailable)', () => {
  it('rebuilds import_job on a v0.3.1 database, keeps every row and accepts the new code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig4-'));
    try {
      db = openDb(':memory:');
      cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      const full = journal.entries;
      expect(full).toHaveLength(5);
      journal.entries = full.slice(0, 4); // v0.3.1 shape
      writeFileSync(journalPath, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      const u = db
        .insert(user)
        .values({ email: 'v@x.test', displayName: 'v', passwordHash: 'h', role: 'member' })
        .returning()
        .get();
      const r = mkRecipe(u.id);
      const statuses = ['queued', 'fetching', 'parsed', 'needs_review', 'failed', 'saved'];
      const ins = db.$client.prepare(
        `INSERT INTO import_job (id, user_id, url, status, method, error_code, draft_json, recipe_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      );
      statuses.forEach((st, i) =>
        ins.run(
          `J${i}`,
          u.id,
          `https://x.example/${i}`,
          st,
          st === 'queued' ? null : 'static',
          st === 'failed' ? 'no_recipe' : null,
          st === 'needs_review' ? '{"v":1}' : null,
          st === 'saved' ? r.id : null,
        ),
      );
      const before = db.$client.prepare('SELECT * FROM import_job ORDER BY id').all();
      journal.entries = full;
      writeFileSync(journalPath, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      expect(db.$client.prepare('SELECT * FROM import_job ORDER BY id').all()).toEqual(before);
      expect(db.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      const idx = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='import_job'")
        .all()
        .map((x) => (x as { name: string }).name);
      expect(idx).toEqual(
        expect.arrayContaining(['import_job_user_created_idx', 'import_job_recipe_id_idx']),
      );
      const j = createImportJob(db, u.id, { url: 'https://x.example/new' });
      expect(() =>
        updateImportJob(db, j.id, { status: 'failed', errorCode: 'headless_unavailable' }),
      ).not.toThrow();
      expect(() => db.$client.prepare("UPDATE import_job SET error_code='bogus'").run()).toThrow(
        /CHECK/,
      );
      // idempotent
      expect(() => migrate(db, { migrationsFolder: dir })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('import_job', () => {
  it('defaults, owner scoping and CHECK enums', () => {
    const { a, b } = setup();
    const j = createImportJob(db, a.id, { url: 'https://x.example/r' });
    expect(j.status).toBe('queued');
    expect(j.method).toBeNull();
    expect(j.errorCode).toBeNull();
    expect(j.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(getImportJobForUser(db, j.id, a.id)?.id).toBe(j.id);
    expect(getImportJobForUser(db, j.id, b.id)).toBeUndefined();
    updateImportJob(db, j.id, { status: 'failed', errorCode: 'no_recipe', method: 'static' });
    expect(getImportJobForUser(db, j.id, a.id)).toMatchObject({
      status: 'failed',
      errorCode: 'no_recipe',
    });
    const raw = (col: string, v: string) =>
      db.$client.prepare(`UPDATE import_job SET ${col} = ? WHERE id = ?`).run(v, j.id);
    expect(() => raw('status', 'bogus')).toThrow(/CHECK/);
    expect(() => raw('method', 'bogus')).toThrow(/CHECK/);
    expect(() => raw('error_code', 'bogus')).toThrow(/CHECK/);
  });

  it('paste jobs have no url; markImportJobSaved is a one-shot compare-and-set', () => {
    const { a, b } = setup();
    const j = createImportJob(db, a.id, { method: 'paste' });
    expect(j.url).toBeNull();
    const r = mkRecipe(a.id);
    expect(markImportJobSaved(db, j.id, a.id, r.id)).toBe(false); // not yet needs_review
    db.update(importJob).set({ status: 'needs_review' }).where(eq(importJob.id, j.id)).run();
    expect(markImportJobSaved(db, j.id, b.id, r.id)).toBe(false); // not the owner
    expect(markImportJobSaved(db, j.id, a.id, r.id)).toBe(true);
    expect(markImportJobSaved(db, j.id, a.id, r.id)).toBe(false); // already saved
    expect(getImportJobForUser(db, j.id, a.id)).toMatchObject({ status: 'saved', recipeId: r.id });
  });

  it('FKs: deleting the recipe nulls recipe_id, deleting the user removes the job', () => {
    const { a } = setup();
    const r = mkRecipe(a.id);
    const j = createImportJob(db, a.id);
    markImportJobSaved(db, j.id, a.id, r.id);
    db.delete(recipe).where(eq(recipe.id, r.id)).run();
    expect(db.select().from(importJob).get()?.recipeId).toBeNull();
    db.delete(user).where(eq(user.id, a.id)).run();
    expect(db.select().from(importJob).all()).toEqual([]);
  });
});

describe('photo', () => {
  it('cascades with the recipe and allows one cover per recipe', () => {
    const { a } = setup();
    const r = mkRecipe(a.id);
    const f = { filePath: 'one.webp', width: 10, height: 10 };
    insertCoverPhoto(db, r.id, f);
    insertCoverPhoto(db, r.id, { ...f, filePath: 'two.webp' }); // replaces the cover flag
    expect(getCoverPhoto(db, r.id)?.filePath).toBe('two.webp');
    expect(listPhotoPathsByRecipe(db, r.id).sort()).toEqual(['one.webp', 'two.webp']);
    expect(() =>
      db
        .insert(photo)
        .values({ recipeId: r.id, isCover: true, ...f, filePath: 'three.webp' })
        .run(),
    ).toThrow(/UNIQUE/);
    db.insert(photo)
      .values({ recipeId: r.id, isCover: false, ...f, filePath: 'four.webp' })
      .run();
    db.delete(recipe).where(eq(recipe.id, r.id)).run();
    expect(db.select().from(photo).all()).toEqual([]);
  });
});

describe('findReadableRecipesBySourceUrl', () => {
  it("finds own and shared recipes, never another user's private one", () => {
    const { a, b } = setup();
    const url = 'https://site.example/pie';
    mkRecipe(a.id, { title: 'mine', sourceUrl: url });
    mkRecipe(b.id, { title: 'theirs-private', sourceUrl: url });
    mkRecipe(b.id, { title: 'theirs-shared', sourceUrl: url, visibility: 'users' });
    mkRecipe(b.id, { title: 'other', sourceUrl: 'https://site.example/other' });
    expect(
      findReadableRecipesBySourceUrl(db, a.id, url)
        .map((r) => r.title)
        .sort(),
    ).toEqual(['mine', 'theirs-shared']);
  });
});
