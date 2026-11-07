import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import { user } from './schema';
import { searchRecipes } from './search';
import { listReadableTags, listTagCounts } from './tags';
import {
  copyRecipeFor,
  createRecipeFor,
  deleteRecipeFor,
  setVisibilityFor,
  updateRecipeFor,
  type Actor,
} from '@/lib/recipes/service';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import type { RecipeInput } from '@/lib/recipes/schemas';

// Security checkpoint T8 (v0.4.0): regression tests for the visibility and cost findings.

let db: Db;
let a: Actor;
let b: Actor;
const mk = (email: string) =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role: 'member' })
    .returning()
    .get() as Actor;
beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  a = mk('a@x.test');
  b = mk('b@x.test');
});
afterEach(() => db.$client.close());

const ing = (name: string) =>
  ({ name, display_primary: 'metric' }) as RecipeInput['sections'][number]['ingredients'][number];
const body = (over: Partial<RecipeInput> = {}, names?: string[][]): RecipeInput =>
  ({
    ...SAMPLE_SKILLET_COOKIES,
    visibility: 'private',
    tags: [],
    ...over,
    sections: names
      ? names.map((n, i) => ({ title: `s${i}`, ingredients: n.map(ing), steps: [] }))
      : SAMPLE_SKILLET_COOKIES.sections,
  }) as RecipeInput;
const make = (actor: Actor, over: Partial<RecipeInput> = {}, names?: string[][]) => {
  const r = createRecipeFor(db, actor, body(over, names));
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.recipe.id;
};
const ftsRow = (id: string) =>
  db.$client.prepare('select * from recipe_fts where recipe_id = ?').get(id) as
    Record<string, string> | undefined;

describe('visibility holds for every read path (T8)', () => {
  it('private tags never appear in autocomplete, chips or counts of another user', () => {
    const priv = make(a, { tags: ['only-a', 'shared'] });
    make(a, { tags: ['shared'], visibility: 'users' });
    expect(listReadableTags(db, b.id, { prefix: 'only' })).toEqual([]);
    expect(listReadableTags(db, b.id, { prefix: '' }).map((t) => [t.name, t.count])).toEqual([
      ['shared', 1],
    ]);
    expect(listTagCounts(db, b.id)).toEqual([{ name: 'shared', count: 1 }]);
    expect(listTagCounts(db, a.id).find((t) => t.name === 'shared')?.count).toBe(2);
    // sharing then unsharing moves the tag in and out of b's view immediately
    expect(setVisibilityFor(db, a, priv, { visibility: 'users' }).ok).toBe(true);
    expect(listTagCounts(db, b.id).map((t) => t.name)).toContain('only-a');
    expect(setVisibilityFor(db, a, priv, { visibility: 'private' }).ok).toBe(true);
    expect(listTagCounts(db, b.id).map((t) => t.name)).not.toContain('only-a');
  });

  it("b cannot find, tag-filter, author-filter or copy a's private recipe; no FTS row survives delete", () => {
    const id = make(a, { tags: ['hidden'], title: 'Zanzibar stew' }, [['quokka']]);
    for (const o of [
      { q: 'zanzibar' },
      { q: 'quokka' },
      { q: 'hidden' },
      { tag: 'hidden' },
      { author: a.id },
      { q: 'zanzibar', tag: 'hidden', author: a.id },
    ])
      expect(searchRecipes(db, b.id, o), JSON.stringify(o)).toEqual([]);
    expect(copyRecipeFor(db, b, id).ok).toBe(false);
    expect(searchRecipes(db, a.id, { q: 'quokka' })).toHaveLength(1);
    expect(deleteRecipeFor(db, a, id).ok).toBe(true);
    expect(ftsRow(id)).toBeUndefined();
    expect(searchRecipes(db, a.id, { q: 'quokka' })).toEqual([]);
  });

  it('a copy is private to the copier and the source stays unaffected', () => {
    const src = make(a, { tags: ['pie'], visibility: 'users' });
    const copied = copyRecipeFor(db, b, src);
    if (!copied.ok) throw new Error('copy failed');
    expect(searchRecipes(db, a.id, { author: b.id })).toEqual([]);
    expect(searchRecipes(db, b.id, { author: 'me', tag: 'pie' }).map((r) => r.id)).toEqual([
      copied.id,
    ]);
  });
});

describe('FTS trigger cost is linear (F1)', () => {
  const sections = (perSection: number) =>
    Array.from({ length: 20 }, (_, s) =>
      Array.from({ length: perSection }, (_, k) => `ingredient${s}x${k} filler words`),
    );

  it('4000 ingredients: create, update, copy and delete stay fast and the index stays exact', () => {
    // Before 0006 this took ~12 s to create and ~23 s to update (quadratic trigger rebuilds).
    const t0 = performance.now();
    const names = sections(200);
    const id = make(a, { tags: ['big', 'bulk'], visibility: 'users' }, names);
    expect(ftsRow(id)!.ingredients.split(' ').length).toBeGreaterThan(8000);
    const upd = updateRecipeFor(db, a, id, body({ tags: ['big'], visibility: 'users' }, names));
    expect(upd.ok).toBe(true);
    const copied = copyRecipeFor(db, b, id);
    if (!copied.ok) throw new Error('copy failed');
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(8000);
    expect(searchRecipes(db, b.id, { q: 'ingredient19x199' }).map((r) => r.id)).toContain(id);
    expect(ftsRow(id)!.tags).toBe('big');
    expect(ftsRow(copied.id)!.tags).toBe('big');
    expect(deleteRecipeFor(db, a, id).ok).toBe(true);
    expect(ftsRow(id)).toBeUndefined();
    expect(db.$client.prepare('select count(*) n from recipe_fts_defer').get()).toEqual({ n: 0 });
  }, 60_000);

  it('the defer marker never outlives a failed write (rollback) and update reindexes', () => {
    const id = make(a, {}, [['alpha']]);
    const bad = updateRecipeFor(
      db,
      a,
      id,
      body({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, [['beta']]),
    );
    expect(bad.ok).toBe(false);
    expect(db.$client.prepare('select count(*) n from recipe_fts_defer').get()).toEqual({ n: 0 });
    expect(ftsRow(id)!.ingredients).toBe('alpha');
    expect(updateRecipeFor(db, a, id, body({ tags: ['t'] }, [['beta']])).ok).toBe(true);
    expect(ftsRow(id)).toMatchObject({ ingredients: 'beta', tags: 't' });
  });

  it('without a marker the ingredient and tag triggers still keep the index in sync', () => {
    const id = make(a, {}, [['alpha']]);
    db.$client
      .prepare(
        `insert into ingredient (id, recipe_id, section_id, position, name, raw_text, display_primary)
         select 'I0DIRECT', recipe_id, section_id, 9, 'direct', 'direct', 'metric' from ingredient where recipe_id = ? limit 1`,
      )
      .run(id);
    expect(ftsRow(id)!.ingredients).toContain('direct');
    db.$client.prepare(`delete from ingredient where id = 'I0DIRECT'`).run();
    expect(ftsRow(id)!.ingredients).toBe('alpha');
  });
});
