import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import {
  copyRecipe,
  createRecipe,
  deleteRecipe,
  getRecipeFull,
  RecipeGuardError,
  replaceRecipe,
  setRecipeVisibility,
  type RecipeTree,
} from './recipes';
import { searchRecipes } from './search';
import { ingredient, recipe, section, step, user } from './schema';

let db: Db;
afterEach(() => db.$client.close());
const mkUser = (email: string, role: 'admin' | 'member' = 'member') =>
  db.insert(user).values({ email, displayName: email, passwordHash: 'h', role }).returning().get();
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  return mkUser('a@x.test');
};

const ing = (name: string, splitGroupId: string | null = null) => ({
  name,
  note: null,
  rawText: name,
  metricQty: null,
  metricUnit: null,
  usQty: null,
  usUnit: null,
  displayPrimary: 'metric' as const,
  splitGroupId,
  portionLabel: null,
  groupLabel: null,
});
const st = (label: string, rowStart: number | null = null, rowEnd: number | null = null) => ({
  kind: 'column' as const,
  label,
  detail: `do ${label}`,
  rowStart,
  rowEnd,
  tempC: null,
  tempF: null,
  minutesMin: null,
  minutesMax: null,
});
const tree = (title = 'R'): RecipeTree => ({
  fields: {
    title,
    description: null,
    servings: null,
    servingsLabel: null,
    prepMinutes: null,
    cookMinutes: null,
    sourceUrl: null,
    sourceName: null,
    visibility: 'private',
    viewMode: 'grid',
  },
  sections: [
    {
      title: 'Cake',
      ingredients: [ing('a', 'g1'), ing('b'), ing('c', 'g1')],
      steps: [st('mix', 0, 1), st('bake', 0, 2)],
    },
    { title: 'Frosting', ingredients: [ing('d')], steps: [st('beat', 0, 0)] },
  ],
});

describe('create / get', () => {
  it('stores positions, fresh split group ids and the owner', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    const r = getRecipeFull(db, id)!;
    expect(r.ownerId).toBe(u.id);
    expect(r.sections.map((s) => s.position)).toEqual([0, 1]);
    const cake = r.sections[0]!;
    expect(cake.ingredients.map((i) => [i.position, i.name])).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, 'c'],
    ]);
    expect(cake.steps.map((s) => s.position)).toEqual([0, 1]);
    const [a, , c] = cake.ingredients;
    expect(a!.splitGroupId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a!.splitGroupId).toBe(c!.splitGroupId);
    expect(a!.splitGroupId).not.toBe('g1');
    expect(r.viewMode).toBe('grid');
  });

  it('rolls back a failing create completely', () => {
    const u = setup();
    const bad = tree();
    bad.sections[0]!.steps.push(st('oops', 3, 1)); // violates step_span_chk
    expect(() => createRecipe(db, u.id, bad)).toThrow();
    expect(db.select().from(recipe).all()).toHaveLength(0);
    expect(db.select().from(section).all()).toHaveLength(0);
  });
});

describe('replaceRecipe', () => {
  it('replaces fields and children and bumps updated_at', async () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree('Old'));
    const before = getRecipeFull(db, id)!;
    await new Promise((r) => setTimeout(r, 5));
    const next = tree('New');
    next.sections = [{ title: null, ingredients: [ing('z')], steps: [] }];
    expect(replaceRecipe(db, id, next)).toBe(true);
    const after = getRecipeFull(db, id)!;
    expect(after.title).toBe('New');
    expect(after.sections).toHaveLength(1);
    expect(after.sections[0]!.ingredients.map((i) => i.name)).toEqual(['z']);
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(after.createdAt).toBe(before.createdAt);
    expect(db.select().from(ingredient).all()).toHaveLength(1);
    expect(replaceRecipe(db, 'missing', next)).toBe(false);
  });

  it('is atomic: a failing child insert leaves the original recipe intact', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree('Original'));
    const bad = tree('Changed');
    bad.sections[1]!.steps = [st('bad', 5, 2)]; // CHECK violation after earlier inserts succeeded
    expect(() => replaceRecipe(db, id, bad)).toThrow();
    const r = getRecipeFull(db, id)!;
    expect(r.title).toBe('Original');
    expect(r.sections.map((s) => s.title)).toEqual(['Cake', 'Frosting']);
    expect(r.sections[0]!.ingredients).toHaveLength(3);
    expect(r.sections[0]!.steps).toHaveLength(2);
  });
});

describe('delete / visibility / list', () => {
  it('delete removes children and nulls copied_from_id on copies', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    const copy = copyRecipe(db, id, u.id)!;
    expect(deleteRecipe(db, id)).toBe(true);
    expect(deleteRecipe(db, id)).toBe(false);
    expect(getRecipeFull(db, id)).toBeUndefined();
    expect(getRecipeFull(db, copy)?.copiedFromId).toBeNull();
    expect(db.select().from(section).all()).toHaveLength(2); // only the copy's
    expect(db.select().from(step).where(eq(step.recipeId, id)).all()).toHaveLength(0);
  });

  it('setRecipeVisibility updates the flag and updated_at', async () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    const before = getRecipeFull(db, id)!;
    await new Promise((r) => setTimeout(r, 5));
    expect(setRecipeVisibility(db, id, 'users')).toBe(true);
    const after = getRecipeFull(db, id)!;
    expect(after.visibility).toBe('users');
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(setRecipeVisibility(db, 'missing', 'users')).toBe(false);
  });

  it("lists own recipes plus other users' users-visible ones, newest first", async () => {
    const a = setup();
    const b = mkUser('b@x.test');
    const mine = createRecipe(db, a.id, tree('mine'));
    await new Promise((r) => setTimeout(r, 3));
    const sharedByB = createRecipe(db, b.id, {
      ...tree('shared'),
      fields: { ...tree().fields, title: 'shared', visibility: 'users' },
    });
    await new Promise((r) => setTimeout(r, 3));
    createRecipe(db, b.id, tree('b-private'));
    const list = searchRecipes(db, a.id);
    expect(list.map((r) => r.id)).toEqual([sharedByB, mine]);
    expect(list[0]).toMatchObject({ ownerDisplayName: 'b@x.test', visibility: 'users' });
    expect(searchRecipes(db, b.id)).toHaveLength(2); // b's own two; a's recipe is private
  });
});

describe('copyRecipe', () => {
  it('deep-copies with fresh ids, remapped split groups and private/ownership reset', () => {
    const a = setup();
    const b = mkUser('b@x.test');
    const src = createRecipe(db, a.id, {
      ...tree(),
      fields: { ...tree().fields, visibility: 'users' },
    });
    db.update(recipe).set({ shareToken: 'tok' }).where(eq(recipe.id, src)).run();
    const id = copyRecipe(db, src, b.id)!;
    const o = getRecipeFull(db, src)!;
    const c = getRecipeFull(db, id)!;
    expect(c).toMatchObject({
      ownerId: b.id,
      visibility: 'private',
      copiedFromId: src,
      shareToken: null,
      viewMode: 'grid',
    });
    expect(c.id).not.toBe(o.id);

    const bare = <T extends object>(row: T) => {
      const rest = { ...row } as Record<string, unknown>;
      for (const k of ['id', 'recipeId', 'sectionId']) delete rest[k];
      return rest;
    };
    const strip = (r: typeof o) =>
      r.sections.map((s) => ({
        title: s.title,
        ingredients: s.ingredients.map((i) => ({
          ...bare({ ...i, splitGroupId: i.splitGroupId !== null }),
        })),
        steps: s.steps.map(bare),
      }));
    expect(strip(c)).toEqual(strip(o));

    const ids = (r: typeof o) => [
      r.id,
      ...r.sections.flatMap((s) => [
        s.id,
        ...s.ingredients.map((i) => i.id),
        ...s.steps.map((t) => t.id),
      ]),
    ];
    expect(ids(c).filter((x) => ids(o).includes(x))).toEqual([]);
    const og = o.sections[0]!.ingredients[0]!.splitGroupId;
    const cg = c.sections[0]!.ingredients[0]!.splitGroupId;
    expect(cg).not.toBe(og);
    expect(c.sections[0]!.ingredients[2]!.splitGroupId).toBe(cg);
  });

  it('copy and original are independent', () => {
    const a = setup();
    const src = createRecipe(db, a.id, tree('Src'));
    const id = copyRecipe(db, src, a.id)!;
    replaceRecipe(db, id, tree('Edited copy'));
    expect(getRecipeFull(db, src)!.title).toBe('Src');
    deleteRecipe(db, id);
    expect(getRecipeFull(db, src)!.sections[0]!.ingredients).toHaveLength(3);
  });

  it('returns undefined for a missing source', () => {
    const a = setup();
    expect(copyRecipe(db, 'nope', a.id)).toBeUndefined();
  });
});

describe('guards run inside the write transaction (no check-then-act gap)', () => {
  const ownerOnly = (ownerId: string) => (row: { ownerId: string }) =>
    row.ownerId === ownerId ? ('ok' as const) : ('forbidden' as const);

  it('a guard evaluated against the stored row refuses after ownership changed, changing nothing', () => {
    const a = setup();
    const b = mkUser('b@x.test');
    const id = createRecipe(db, a.id, tree('Original'));
    // Ownership moves to b between the caller's earlier read and the write.
    db.update(recipe).set({ ownerId: b.id }).where(eq(recipe.id, id)).run();
    const guard = ownerOnly(a.id);
    expect(() => replaceRecipe(db, id, tree('Hacked'), { guard })).toThrow(RecipeGuardError);
    expect(() => deleteRecipe(db, id, guard)).toThrow(RecipeGuardError);
    expect(() => setRecipeVisibility(db, id, 'users', guard)).toThrow(RecipeGuardError);
    expect(() => copyRecipe(db, id, a.id, guard)).toThrow(RecipeGuardError);
    const r = getRecipeFull(db, id)!;
    expect(r.title).toBe('Original');
    expect(r.visibility).toBe('private');
    expect(r.sections).toHaveLength(2);
    expect(db.select().from(recipe).all()).toHaveLength(1);
  });

  it('guard verdicts map to the error status; ok proceeds', () => {
    const a = setup();
    const id = createRecipe(db, a.id, tree());
    try {
      deleteRecipe(db, id, () => 'not_found');
    } catch (e) {
      expect((e as RecipeGuardError).status).toBe('not_found');
    }
    expect(deleteRecipe(db, id, () => 'ok')).toBe(true);
  });

  it('replaceRecipe viewMode resolver receives the stored value', () => {
    const a = setup();
    const id = createRecipe(db, a.id, tree()); // grid
    let seen = '';
    replaceRecipe(db, id, tree(), {
      viewMode: (stored) => {
        seen = stored;
        return 'list';
      },
    });
    expect(seen).toBe('grid');
    expect(getRecipeFull(db, id)!.viewMode).toBe('list');
  });
});
