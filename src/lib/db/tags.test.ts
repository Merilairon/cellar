import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import { recipe, recipeTag, tag, user } from './schema';
import {
  TagLimitError,
  listReadableTags,
  listTagCounts,
  listTagsForRecipe,
  setRecipeTags,
} from './tags';
import {
  copyRecipe,
  createRecipe,
  deleteRecipe,
  getRecipeFull,
  replaceRecipe,
  type RecipeTree,
} from './recipes';

let db: Db;
let a: string;
let b: string;
const mk = (email: string) =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role: 'member' })
    .returning()
    .get().id;

const tree = (
  over: Partial<RecipeTree> = {},
  vis: 'private' | 'users' = 'private',
): RecipeTree => ({
  fields: { title: 'T', visibility: vis, viewMode: 'list' },
  sections: [{ title: null, ingredients: [{ name: 'egg', rawText: 'egg' }], steps: [] }],
  ...over,
});
const tagNames = () =>
  db
    .select()
    .from(tag)
    .all()
    .map((t) => t.name)
    .sort();

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  a = mk('a@x.test');
  b = mk('b@x.test');
});
afterEach(() => db.$client.close());

describe('recipe tags persistence', () => {
  it('dedupes on create and old recipes load with tags []', () => {
    const id = createRecipe(db, a, tree({ tags: ['dessert', 'chocolate', 'dessert'] }));
    expect(getRecipeFull(db, id)!.tags).toEqual(['chocolate', 'dessert']);
    const plain = createRecipe(db, a, tree());
    expect(getRecipeFull(db, plain)!.tags).toEqual([]);
  });

  it('replace: omitted keeps, [] clears, diff removes link and orphan, shared tag stays', () => {
    const r1 = createRecipe(db, a, tree({ tags: ['dessert', 'chocolate'] }));
    const r2 = createRecipe(db, a, tree({ tags: ['dessert'] }));
    replaceRecipe(db, r1, tree());
    expect(listTagsForRecipe(db, r1)).toEqual(['chocolate', 'dessert']);
    replaceRecipe(db, r1, tree({ tags: ['dessert'] }));
    expect(listTagsForRecipe(db, r1)).toEqual(['dessert']);
    expect(tagNames()).toEqual(['dessert']); // chocolate orphan removed
    replaceRecipe(db, r1, tree({ tags: [] }));
    expect(listTagsForRecipe(db, r1)).toEqual([]);
    expect(tagNames()).toEqual(['dessert']); // still used by r2
    expect(listTagsForRecipe(db, r2)).toEqual(['dessert']);
  });

  it('delete recipe removes orphan tags but keeps shared ones', () => {
    const r1 = createRecipe(db, a, tree({ tags: ['solo', 'shared'] }));
    createRecipe(db, a, tree({ tags: ['shared'] }));
    deleteRecipe(db, r1);
    expect(tagNames()).toEqual(['shared']);
  });

  it('copy copies tags (G19) and the FTS tags column follows', () => {
    const src = createRecipe(db, a, tree({ tags: ['soup', 'winter'] }, 'users'));
    const cp = copyRecipe(db, src, b)!;
    expect(getRecipeFull(db, cp)!.tags).toEqual(['soup', 'winter']);
    const row = db.$client.prepare('SELECT tags FROM recipe_fts WHERE recipe_id = ?').get(cp) as {
      tags: string;
    };
    expect(row.tags).toBe('soup winter');
  });

  it('a failed replace rolls back tag changes', () => {
    const r1 = createRecipe(db, a, tree({ tags: ['keep'] }));
    expect(() =>
      replaceRecipe(db, r1, tree({ tags: ['new'] }), {
        guard: () => 'forbidden',
      }),
    ).toThrow();
    expect(listTagsForRecipe(db, r1)).toEqual(['keep']);
    expect(tagNames()).toEqual(['keep']);
  });
});

describe('tag limit', () => {
  it('20 tags fit; the 21st maps the trigger error to TagLimitError and rolls back', () => {
    const names = Array.from({ length: 20 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    const id = createRecipe(db, a, tree({ tags: names }));
    expect(listTagsForRecipe(db, id)).toHaveLength(20);
    expect(() => replaceRecipe(db, id, tree({ tags: [...names, 't99'] }))).toThrow(TagLimitError);
    expect(listTagsForRecipe(db, id)).toHaveLength(20);
    expect(tagNames()).not.toContain('t99');
  });

  it('replacing a full set with a different full set works (removals before inserts)', () => {
    const names = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const id = createRecipe(db, a, tree({ tags: names }));
    const other = Array.from({ length: 20 }, (_, i) => `b${i}`);
    replaceRecipe(db, id, tree({ tags: other }));
    expect(listTagsForRecipe(db, id)).toHaveLength(20);
    expect(tagNames()).toHaveLength(20);
  });

  it('setRecipeTags directly beyond 20 throws TagLimitError', () => {
    const id = createRecipe(db, a, tree());
    const names = Array.from({ length: 21 }, (_, i) => `n${i}`);
    expect(() => db.transaction((tx) => setRecipeTags(tx, id, names))).toThrow(TagLimitError);
  });

  it('rejects names that fail normalization instead of storing them', () => {
    const id = createRecipe(db, a, tree());
    expect(() => db.transaction((tx) => setRecipeTags(tx, id, ['  ']))).toThrow();
  });
});

describe('listReadableTags / listTagCounts', () => {
  beforeEach(() => {
    createRecipe(db, a, tree({ tags: ['secret-a', 'pasta', 'quick'] }, 'private'));
    createRecipe(db, a, tree({ tags: ['pasta', 'quick'] }, 'users'));
    createRecipe(db, b, tree({ tags: ['pasta', 'secret-b'] }, 'private'));
  });

  it('user B never sees a tag that exists only on A private recipes; counts only readable', () => {
    const forB = listTagCounts(db, b);
    expect(forB.map((t) => t.name)).not.toContain('secret-a');
    expect(forB).toEqual([
      { name: 'pasta', count: 2 }, // A users-visible + B own; A private not counted
      { name: 'quick', count: 1 },
      { name: 'secret-b', count: 1 },
    ]);
    const forA = listTagCounts(db, a);
    expect(forA.map((t) => t.name)).not.toContain('secret-b');
    expect(forA.find((t) => t.name === 'pasta')!.count).toBe(2);
  });

  it('prefix match on the normalized name, limit, and ordering by count then name', () => {
    expect(listReadableTags(db, a, { prefix: 'PA' })).toEqual([{ name: 'pasta', count: 2 }]);
    expect(listReadableTags(db, a, { limit: 1 })).toHaveLength(1);
  });

  it('LIKE wildcards in the prefix are literal', () => {
    expect(listReadableTags(db, a, { prefix: '%' })).toEqual([]);
    expect(listReadableTags(db, a, { prefix: '_' })).toEqual([]);
    expect(listReadableTags(db, a, { prefix: '\\' })).toEqual([]);
    const id = createRecipe(db, a, tree({ tags: ['50%_off'] }));
    expect(id).toBeTruthy();
    expect(listReadableTags(db, a, { prefix: '50%_' }).map((t) => t.name)).toEqual(['50%_off']);
    expect(listReadableTags(db, a, { prefix: '5_%' })).toEqual([]);
  });

  it('autocomplete is capped at 10 by default', () => {
    createRecipe(db, a, tree({ tags: Array.from({ length: 15 }, (_, i) => `zz${i}`) }));
    expect(listReadableTags(db, a, { prefix: 'zz' })).toHaveLength(10);
  });

  it('visibility change is reflected immediately', () => {
    db.update(recipe).set({ visibility: 'users' }).where(eq(recipe.ownerId, a)).run();
    expect(listTagCounts(db, b).map((t) => t.name)).toContain('secret-a');
  });
});

it('links cascade-delete with the recipe', () => {
  const id = createRecipe(db, a, tree({ tags: ['x'] }));
  db.delete(recipe).where(eq(recipe.id, id)).run();
  expect(db.select().from(recipeTag).all()).toEqual([]);
});
