import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import {
  copyRecipe,
  createRecipe,
  deleteRecipe,
  getRecipeFull,
  GridConflictError,
  RecipeGuardError,
  replaceGrid,
  replaceRecipe,
  setRecipeVisibility,
  type RecipeTree,
} from './recipes';
import { searchRecipes } from './search';
import { reindexRecipe } from './fts';
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

describe('replaceGrid', () => {
  const snapshot = (id: string) => ({
    full: getRecipeFull(db, id),
    fts: db.$client.prepare('select * from recipe_fts where recipe_id = ?').all(id),
    defer: db.$client.prepare('select count(*) n from recipe_fts_defer').get(),
  });
  const newSections = (): RecipeTree['sections'] => [
    { title: 'New', ingredients: [ing('zucchini'), ing('leek')], steps: [st('chop', 0, 1)] },
  ];
  const opts = (id: string, over: Partial<Parameters<typeof replaceGrid>[3]> = {}) => ({
    baseUpdatedAt: getRecipeFull(db, id)!.updatedAt,
    viewMode: 'grid' as const,
    ...over,
  });

  it('replaces children only, bumps updated_at, keeps fields and tags, FTS equals a rebuild', () => {
    const u = setup();
    const t = tree('Keep me');
    t.tags = ['soup', 'quick'];
    t.fields.servings = 4;
    const id = createRecipe(db, u.id, t);
    const before = getRecipeFull(db, id)!;
    expect(replaceGrid(db, id, newSections(), opts(id, { viewMode: 'list' }))).toBe(true);
    const after = getRecipeFull(db, id)!;
    expect(after.sections.map((s) => s.ingredients.map((i) => i.name))).toEqual([
      ['zucchini', 'leek'],
    ]);
    expect(after.title).toBe('Keep me');
    expect(after.servings).toBe(4);
    expect(after.visibility).toBe('private');
    expect([...after.tags].sort()).toEqual(['quick', 'soup']);
    expect(after.viewMode).toBe('list');
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(after.createdAt).toBe(before.createdAt);
    const fts = db.$client.prepare('select * from recipe_fts where recipe_id = ?').all(id);
    expect(JSON.stringify(fts)).toContain('zucchini');
    expect(JSON.stringify(fts)).not.toContain('"a b c');
    reindexRecipe(db, id);
    expect(db.$client.prepare('select * from recipe_fts where recipe_id = ?').all(id)).toEqual(fts);
  });

  it('stamps a strictly newer updated_at even within one millisecond', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    const stamp = getRecipeFull(db, id)!.updatedAt;
    const future = new Date(Date.now() + 60_000).toISOString();
    db.update(recipe).set({ updatedAt: future }).where(eq(recipe.id, id)).run();
    replaceGrid(db, id, newSections(), { baseUpdatedAt: future, viewMode: 'grid' });
    expect(getRecipeFull(db, id)!.updatedAt > future).toBe(true);
    expect(stamp).toBeTruthy();
  });

  it('throws GridConflictError with the stored stamp and writes nothing on a stale base', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    const snap = snapshot(id);
    const stored = snap.full!.updatedAt;
    try {
      replaceGrid(db, id, newSections(), {
        baseUpdatedAt: '2000-01-01T00:00:00.000Z',
        viewMode: 'grid',
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GridConflictError);
      expect((e as GridConflictError).currentUpdatedAt).toBe(stored);
    }
    expect(snapshot(id)).toEqual(snap);
  });

  it('rolls back completely when an insert fails mid-way (children, stamp, view_mode, FTS, defer marker)', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    const snap = snapshot(id);
    const bad = newSections();
    bad[0]!.ingredients.push(ing('third'));
    bad[0]!.steps.push(st('oops', 3, 1)); // violates step_span_chk after ingredients are written
    expect(() => replaceGrid(db, id, bad, opts(id, { viewMode: 'list' }))).toThrow();
    expect(snapshot(id)).toEqual(snap);
  });

  it('runs the guard on the stored row inside the transaction and writes nothing when it refuses', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    const snap = snapshot(id);
    expect(() =>
      replaceGrid(db, id, newSections(), opts(id, { guard: () => 'forbidden' })),
    ).toThrow(RecipeGuardError);
    expect(() =>
      replaceGrid(db, id, newSections(), opts(id, { guard: () => 'not_found' })),
    ).toThrow(RecipeGuardError);
    expect(snapshot(id)).toEqual(snap);
  });

  it('the guard wins over the conflict check (a refused caller never learns the stamp)', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    expect(() =>
      replaceGrid(db, id, newSections(), {
        baseUpdatedAt: 'stale',
        viewMode: 'grid',
        guard: () => 'not_found',
      }),
    ).toThrow(RecipeGuardError);
  });

  it('returns false for an unknown recipe', () => {
    setup();
    expect(replaceGrid(db, 'nope', newSections(), { baseUpdatedAt: 'x', viewMode: 'grid' })).toBe(
      false,
    );
  });

  it('prints timings for maximal replaces (C11, no assertion)', () => {
    const u = setup();
    const id = createRecipe(db, u.id, tree());
    for (const [secs, per] of [
      [1, 200],
      [5, 40],
    ] as const) {
      const sections: RecipeTree['sections'] = Array.from({ length: secs }, (_, s) => ({
        title: `S${s}`,
        ingredients: Array.from({ length: per }, (_, i) => ing(`item ${s}-${i}`)),
        steps: [st('all', 0, per - 1)],
      }));
      const t0 = performance.now();
      replaceGrid(db, id, sections, opts(id));
      console.info(`replaceGrid ${secs}x${per}: ${(performance.now() - t0).toFixed(1)} ms`);
    }
  });
});
