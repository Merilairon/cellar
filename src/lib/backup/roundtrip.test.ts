import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/connection';
import { insertRecipeTree } from '@/lib/db/recipes';
import { note, photo, rating, recipe, user } from '@/lib/db/schema';
import { buildBackup } from './export';
import { migrateBackup } from './migrate';
import { parseBackupJson } from './parse';
import type { BackupRecipe, BackupV1 } from './schema';
import { backupRecipeToTree, toTrees } from './toTree';
import {
  addNote,
  addPhotos,
  addRating,
  maximalRecipe,
  memDb,
  mkUser,
  saveInput,
  SAMPLE_INPUTS,
} from './test-fixtures';

const dbs: Db[] = [];
const fresh = () => {
  const d = memDb();
  dbs.push(d);
  return d;
};
afterEach(() => {
  while (dbs.length) dbs.pop()!.$client.close();
});

/** Compare modulo the stamps the restore re-creates. */
function normalize(doc: BackupV1) {
  const strip = <T extends { created_at: string; updated_at: string }>(x: T) => ({
    ...x,
    created_at: '*',
    updated_at: '*',
  });
  return {
    ...doc,
    exported_at: '*',
    recipes: [...doc.recipes]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => ({
        ...strip(r),
        // Rows stamped in the same millisecond have no defined order; compare as sets.
        notes: r.notes.map(strip).sort((x, y) => x.body.localeCompare(y.body)),
        ratings: r.ratings.map(strip),
      })),
  };
}

const viaJson = (doc: BackupV1): BackupV1 => {
  const p = parseBackupJson(JSON.stringify(doc));
  if (!p.ok) throw new Error('parse');
  const m = migrateBackup(p.value);
  if (!m.ok) throw new Error(`migrate ${JSON.stringify(m)}`);
  return m.doc;
};

function restoreTrees(target: Db, ownerId: string, doc: BackupV1) {
  for (const tree of toTrees(doc)) insertRecipeTree(target, ownerId, tree);
}

describe('backup round trip at the tree level', () => {
  const cases: Array<[string, () => Parameters<typeof saveInput>[2]]> = [
    ['sample: skillet cookie (one section, spans 0-0 0-3 0-4 0-8)', () => SAMPLE_INPUTS[0]],
    ['sample: vanilla cake (two sections, split group, bottom banner)', () => SAMPLE_INPUTS[1]],
    ['maximal 20-section recipe', maximalRecipe],
  ];
  it.each(cases)('%s', (_name, input) => {
    const a = fresh();
    const ua = mkUser(a, 'a@x.test');
    saveInput(a, ua.id, input());
    const first = viaJson(buildBackup(a, ua, { all: false }));

    const b = fresh();
    const ub = mkUser(b, 'b@x.test');
    restoreTrees(b, ub.id, first);
    const second = viaJson(buildBackup(b, ub, { all: false }));

    expect(normalize(second)).toEqual(normalize(first));
    // Spans and split groups are asserted explicitly too, not only through the deep-equal.
    const spans = (d: BackupV1) =>
      d.recipes[0].sections.flatMap((s) => s.steps.map((t) => [t.kind, t.row_start, t.row_end]));
    expect(spans(second)).toEqual(spans(first));
    expect(spans(first).some(([k, s]) => k === 'column' && s !== null)).toBe(true);
    const groups = (d: BackupV1) =>
      d.recipes[0].sections.flatMap((s) => s.ingredients.map((i) => i.split_group_key));
    expect(groups(second)).toEqual(groups(first));
  });

  it('the two samples and the maximal recipe together, in one backup', () => {
    const a = fresh();
    const ua = mkUser(a, 'a@x.test');
    for (const i of [...SAMPLE_INPUTS, maximalRecipe()]) saveInput(a, ua.id, i);
    const first = viaJson(buildBackup(a, ua, { all: false }));
    const b = fresh();
    const ub = mkUser(b, 'b@x.test');
    restoreTrees(b, ub.id, first);
    const second = viaJson(buildBackup(b, ub, { all: false }));
    expect(second.recipes).toHaveLength(3);
    expect(normalize(second)).toEqual(normalize(first));
  });

  it('split groups get fresh stored ULIDs on restore, still grouped', () => {
    const a = fresh();
    const ua = mkUser(a, 'a@x.test');
    saveInput(a, ua.id, SAMPLE_INPUTS[1]);
    const doc = viaJson(buildBackup(a, ua, { all: false }));
    const b = fresh();
    const ub = mkUser(b, 'b@x.test');
    const id = insertRecipeTree(b, ub.id, backupRecipeToTree(doc.recipes[0]));
    const rows = b.$client
      .prepare(
        'select split_group_id g from ingredient where recipe_id = ? and split_group_id is not null',
      )
      .all(id) as Array<{ g: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].g).toBe(rows[1].g);
    expect(rows[0].g).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(rows[0].g).not.toBe('g1');
  });

  it('restore stamps are new, the file stamps are kept as data only', () => {
    const a = fresh();
    const ua = mkUser(a, 'a@x.test');
    saveInput(a, ua.id, SAMPLE_INPUTS[0]);
    const doc = buildBackup(a, ua, { all: false });
    doc.recipes[0].created_at = '2001-01-01T00:00:00.000Z';
    doc.recipes[0].updated_at = '2001-01-02T00:00:00.000Z';
    const b = fresh();
    const ub = mkUser(b, 'b@x.test');
    restoreTrees(b, ub.id, viaJson(doc));
    const row = b.select().from(recipe).get()!;
    expect(row.createdAt > '2020').toBe(true);
    expect(row.ownerId).toBe(ub.id);
  });
});

describe('whole-instance round trip (admin all) with notes, ratings and photos', () => {
  it('rebuilds an equal all-scope document in a second instance', () => {
    const a = fresh();
    const admin = mkUser(a, 'admin@x.test', 'admin');
    const ann = mkUser(a, 'ann@x.test');
    const r1 = saveInput(a, ann.id, { ...SAMPLE_INPUTS[0], visibility: 'users' });
    const r2 = saveInput(a, admin.id, SAMPLE_INPUTS[1]);
    addPhotos(a, r1, 2, true);
    addNote(a, r1, ann.id, 'mine', false);
    addNote(a, r1, admin.id, 'shared by admin', true);
    addRating(a, r1, ann.id, 4);
    addRating(a, r2, admin.id, 2);
    const first = viaJson(buildBackup(a, admin, { all: true }));

    // Restore: users by email, recipes by owner_email, then photos/notes/ratings as data.
    const b = fresh();
    const idByEmail = new Map<string, string>();
    for (const u of first.users!) {
      const row = b
        .insert(user)
        .values({
          email: u.email,
          displayName: u.display_name,
          passwordHash: 'x',
          role: u.role,
          unitPref: u.unit_pref,
          locale: u.locale,
        })
        .returning({ id: user.id })
        .get();
      idByEmail.set(u.email, row.id);
    }
    first.recipes.forEach((r: BackupRecipe) => {
      const id = insertRecipeTree(b, idByEmail.get(r.owner_email!)!, backupRecipeToTree(r));
      r.photos.forEach((p) =>
        b
          .insert(photo)
          .values({
            recipeId: id,
            filePath: p.file.slice(7),
            thumbPath: p.thumb?.slice(7) ?? null,
            width: p.width,
            height: p.height,
            position: p.position,
            isCover: p.is_cover,
          })
          .run(),
      );
      r.notes.forEach((n) =>
        b
          .insert(note)
          .values({
            recipeId: id,
            userId: idByEmail.get(n.author_email!)!,
            body: n.body,
            shared: n.shared,
            createdAt: n.created_at,
            updatedAt: n.updated_at,
          })
          .run(),
      );
      r.ratings.forEach((x) =>
        b
          .insert(rating)
          .values({
            recipeId: id,
            userId: idByEmail.get(x.user_email!)!,
            stars: x.stars,
            createdAt: x.created_at,
            updatedAt: x.updated_at,
          })
          .run(),
      );
    });
    const second = viaJson(
      buildBackup(b, b.select().from(user).where(eq(user.email, 'admin@x.test')).get()!, {
        all: true,
      }),
    );
    // Photo file names are kept by this test; only stamps differ.
    expect(normalize(second)).toEqual(normalize(first));
  });
});
