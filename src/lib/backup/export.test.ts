import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/connection';
import { photo } from '@/lib/db/schema';
import { BackupForbiddenError, BackupExportError, buildBackup, listBackupFiles } from './export';
import { migrateBackup } from './migrate';
import { backupV1Schema, PHOTO_PATH_RE } from './schema';
import {
  addNote,
  addPhotos,
  addRating,
  maximalRecipe,
  memDb,
  mkUser,
  saveInput,
  SAMPLE_INPUTS,
  type U,
} from './test-fixtures';
import { setRecipeVisibility } from '@/lib/db/recipes';

let db: Db;
afterEach(() => db.$client.close());

function world() {
  db = memDb();
  const admin = mkUser(db, 'admin@x.test', 'admin');
  const ann = mkUser(db, 'ann@x.test');
  const bob = mkUser(db, 'bob@x.test');
  const annR = saveInput(db, ann.id, { ...SAMPLE_INPUTS[0], title: 'Ann cookies' });
  const annShared = saveInput(db, ann.id, {
    ...SAMPLE_INPUTS[1],
    title: 'Ann cake',
    visibility: 'users',
  });
  const bobPrivate = saveInput(db, bob.id, { ...SAMPLE_INPUTS[0], title: 'Bob private' });
  const bobUsers = saveInput(db, bob.id, {
    ...SAMPLE_INPUTS[1],
    title: 'Bob visible',
    visibility: 'users',
  });
  return { admin, ann, bob, annR, annShared, bobPrivate, bobUsers };
}
const own = (w: { ann: U }) => buildBackup(db, w.ann, { all: false, appVersion: '0.5.1' });

describe('buildBackup: member shape', () => {
  it('exports owner_id = me recipes only; another user users-visible recipe is not included', () => {
    const w = world();
    const doc = own(w);
    expect(doc.recipes.map((r) => r.title).sort()).toEqual(['Ann cake', 'Ann cookies']);
    expect(doc.scope).toBe('own');
    expect(doc.users).toBeUndefined();
    expect(doc.version).toBe(1);
    expect(doc.app_version).toBe('0.5.1');
    expect(JSON.stringify(doc)).not.toContain('Bob');
  });
  it('an admin actor without all gets the member shape', () => {
    const w = world();
    const doc = buildBackup(db, w.admin, { all: false });
    expect(doc.recipes).toEqual([]);
    expect(doc.users).toBeUndefined();
  });
  it('notes: own private and shared, others shared with author name only, never others private', () => {
    const w = world();
    addNote(db, w.annR, w.ann.id, 'ann private', false);
    addNote(db, w.annR, w.ann.id, 'ann shared', true);
    addNote(db, w.annR, w.bob.id, 'bob private SECRET', false);
    addNote(db, w.annR, w.bob.id, 'bob shared', true);
    const notes = own(w).recipes.find((r) => r.title === 'Ann cookies')!.notes;
    expect(notes.map((n) => n.body).sort()).toEqual(['ann private', 'ann shared', 'bob shared']);
    const bobs = notes.find((n) => n.body === 'bob shared')!;
    expect(bobs).toMatchObject({ author_display_name: 'Name of bob', mine: false, shared: true });
    expect(bobs).not.toHaveProperty('author_email');
    expect(notes.find((n) => n.body === 'ann private')).toMatchObject({
      mine: true,
      shared: false,
    });
  });
  it("ratings: only the caller's own, without identity", () => {
    const w = world();
    addRating(db, w.annR, w.ann.id, 4);
    addRating(db, w.annR, w.bob.id, 1);
    addRating(db, w.annShared, w.bob.id, 2);
    const doc = own(w);
    const r = doc.recipes.find((x) => x.title === 'Ann cookies')!;
    expect(r.ratings).toHaveLength(1);
    expect(r.ratings[0]).toMatchObject({ stars: 4 });
    expect(r.ratings[0]).not.toHaveProperty('user_email');
    expect(doc.recipes.find((x) => x.title === 'Ann cake')!.ratings).toEqual([]);
  });
  it('visibility change of another users recipe does not leak it either way', () => {
    const w = world();
    setRecipeVisibility(db, w.bobPrivate, 'users');
    expect(own(w).recipes.map((r) => r.title)).not.toContain('Bob private');
  });
});

describe('buildBackup: admin all shape', () => {
  it('every recipe, note, rating, and users without hashes', () => {
    const w = world();
    addNote(db, w.bobPrivate, w.bob.id, 'bob private note', false);
    addNote(db, w.bobPrivate, w.admin.id, 'admin note', true);
    addRating(db, w.bobPrivate, w.bob.id, 3);
    addRating(db, w.bobPrivate, w.admin.id, 5);
    const doc = buildBackup(db, w.admin, { all: true });
    expect(doc.scope).toBe('all');
    expect(doc.recipes).toHaveLength(4);
    expect(doc.users!.map((u) => u.email)).toEqual(['admin@x.test', 'ann@x.test', 'bob@x.test']);
    expect(Object.keys(doc.users![0]).sort()).toEqual([
      'display_name',
      'email',
      'locale',
      'role',
      'unit_pref',
    ]);
    const r = doc.recipes.find((x) => x.title === 'Bob private')!;
    expect(r.owner_email).toBe('bob@x.test');
    expect(r.notes.map((n) => [n.body, n.author_email]).sort()).toEqual([
      ['admin note', 'admin@x.test'],
      ['bob private note', 'bob@x.test'],
    ]);
    expect(r.notes.every((n) => !('mine' in n))).toBe(true);
    expect(r.ratings.map((x) => [x.stars, x.user_email])).toEqual([
      [5, 'admin@x.test'],
      [3, 'bob@x.test'],
    ]);
  });
  it('a forged admin role is not enough: the stored role and active state decide', () => {
    const w = world();
    expect(() => buildBackup(db, { id: w.ann.id, role: 'admin' }, { all: true })).toThrow(
      BackupForbiddenError,
    );
    db.$client
      .prepare('update user set deactivated_at = ? where id = ?')
      .run('2030-01-01T00:00:00.000Z', w.admin.id);
    expect(() => buildBackup(db, w.admin, { all: true })).toThrow(BackupForbiddenError);
  });
  it('is refused for a member actor (builder-level 403)', () => {
    const w = world();
    expect(() => buildBackup(db, w.ann, { all: true })).toThrow(BackupForbiddenError);
  });
});

describe('buildBackup: photos, ids, validity', () => {
  it('photo paths match the regex, thumb is null for legacy rows, positions renumbered', () => {
    const w = world();
    addPhotos(db, w.annR, 3, true);
    const doc = own(w);
    const photos = doc.recipes.find((r) => r.title === 'Ann cookies')!.photos;
    expect(photos.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(photos[0].is_cover).toBe(true);
    for (const p of photos) {
      expect(PHOTO_PATH_RE.test(p.file)).toBe(true);
      if (p.thumb) expect(PHOTO_PATH_RE.test(p.thumb)).toBe(true);
    }
    expect(photos[2].thumb).toBeNull();
    const files = listBackupFiles(doc);
    expect(files).toHaveLength(5);
    expect(new Set(files).size).toBe(5);
    expect(files.every((f) => PHOTO_PATH_RE.test(f))).toBe(true);
  });
  it('refuses to write a backup with an unrepresentable stored photo path', () => {
    const w = world();
    db.insert(photo).values({ recipeId: w.annR, filePath: '../x.png', width: 1, height: 1 }).run();
    expect(() => own(w)).toThrow(BackupExportError);
  });
  it('output validates through migrateBackup in both scopes and carries no ids', () => {
    const w = world();
    addPhotos(db, w.annR, 2);
    addNote(db, w.annR, w.bob.id, 'shared', true);
    addRating(db, w.annR, w.ann.id, 5);
    const ids = [w.annR, w.annShared, w.bobPrivate, w.bobUsers, w.ann.id, w.bob.id, w.admin.id];
    for (const doc of [own(w), buildBackup(db, w.admin, { all: true })]) {
      const parsed = JSON.parse(JSON.stringify(doc));
      expect(migrateBackup(parsed).ok).toBe(true);
      expect(backupV1Schema.safeParse(parsed).success).toBe(true);
      const text = JSON.stringify(doc);
      for (const id of ids) expect(text).not.toContain(id);
    }
  });
  it('split groups become local keys g1..gn, shared across rows of one ingredient', () => {
    const w = world();
    const doc = own(w);
    const cake = doc.recipes.find((r) => r.title === 'Ann cake')!;
    const keys = cake.sections[0].ingredients.map((i) => i.split_group_key);
    expect(keys.filter((k) => k !== null)).toEqual(['g1', 'g1']);
    expect(JSON.stringify(doc)).not.toMatch(/split_group_id/);
  });
  it('maximal recipe: 20 sections exported in order with positions', () => {
    const w = world();
    saveInput(db, w.ann.id, maximalRecipe());
    const r = own(w).recipes.find((x) => x.title === 'Maximal')!;
    expect(r.sections).toHaveLength(20);
    expect(r.sections.map((s) => s.position)).toEqual([...Array(20).keys()]);
    expect(r.tags).toHaveLength(20);
  });
  it('exported_at honours the clock seam', () => {
    const w = world();
    const doc = buildBackup(db, w.ann, { all: false, now: new Date('2026-02-03T04:05:06.007Z') });
    expect(doc.exported_at).toBe('2026-02-03T04:05:06.007Z');
    expect(doc.app_version).toBe('unknown');
  });
});
