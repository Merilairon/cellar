import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { deactivateUser } from '@/lib/auth/admin';
import { user } from '@/lib/db/schema';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from './samples';
import {
  copyRecipeFor,
  createRecipeFor,
  defaultViewMode,
  deleteRecipeFor,
  getRecipeFor,
  listRecipes,
  prepareRecipe,
  setVisibilityFor,
  updateRecipeFor,
} from './service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

let db: Db;
afterEach(() => db.$client.close());
const mk = (email: string, role: 'admin' | 'member' = 'member') =>
  db.insert(user).values({ email, displayName: email, passwordHash: 'h', role }).returning().get();
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  return { owner: mk('o@x.test'), other: mk('x@x.test'), admin: mk('a@x.test', 'admin') };
};
const clone = () => structuredClone(SAMPLE_SKILLET_COOKIES) as Loose;
const okRecipe = (r: ReturnType<typeof createRecipeFor>) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.recipe;
};

describe('owner deactivation', () => {
  it('keeps users-visible recipes readable and copyable; admins still read and write any recipe', () => {
    const { owner, other, admin } = setup();
    const shared = okRecipe(createRecipeFor(db, owner, { ...clone(), visibility: 'users' })).id;
    const priv = okRecipe(createRecipeFor(db, owner, { ...clone(), visibility: 'private' })).id;
    expect(deactivateUser(db, owner.id)).toBe('ok');

    expect(getRecipeFor(db, other, shared)).toMatchObject({ ok: true });
    expect(listRecipes(db, other).map((r) => r.id)).toContain(shared);
    expect(copyRecipeFor(db, other, shared)).toMatchObject({ ok: true });
    expect(getRecipeFor(db, other, priv)).toEqual({ ok: false, status: 404 });

    expect(getRecipeFor(db, admin, priv)).toMatchObject({ ok: true });
    expect(updateRecipeFor(db, admin, priv, { ...clone(), title: 'Edited' })).toMatchObject({
      ok: true,
    });
    expect(deleteRecipeFor(db, admin, priv)).toMatchObject({ ok: true });
  });
});

describe('ingredient ranges', () => {
  it('round-trip through create, get, update and copy', () => {
    const { owner } = setup();
    const body = {
      title: 'Glaze',
      sections: [
        {
          ingredients: [
            { name: 'honey', us_qty: 2, us_qty_max: 3, us_unit: 'tbsp', display_primary: 'us' },
            { name: 'flour', metric_qty: 100, metric_qty_max: 150, metric_unit: 'g' },
            { name: 'salt', metric_qty: 1 },
          ],
          steps: [],
        },
      ],
    };
    const made = okRecipe(createRecipeFor(db, owner, body));
    const [honey, flour, salt] = made.sections[0]!.ingredients;
    // T7: the missing metric side is derived (honey is weight-measured), both bounds.
    expect(honey).toMatchObject({ us_qty: 2, us_qty_max: 3, metric_unit: 'g' });
    expect(honey!.metric_qty_max).toBeGreaterThan(honey!.metric_qty!);
    expect(flour).toMatchObject({ metric_qty: 100, metric_qty_max: 150, us_unit: 'oz' });
    // Unitless count: nothing derived.
    expect(salt).toMatchObject({ metric_qty_max: null, us_qty: null, us_qty_max: null });
    expect(honey!.raw_text).toBe('2-3 tbsp honey');

    const upd = updateRecipeFor(db, owner, made.id, { ...body, title: 'Glaze 2' });
    expect(upd.ok && upd.recipe.sections[0]!.ingredients[0]).toMatchObject({ us_qty_max: 3 });

    const copy = copyRecipeFor(db, owner, made.id) as { id: string };
    const got = getRecipeFor(db, owner, copy.id);
    expect(got.ok && got.recipe.sections[0]!.ingredients[1]).toMatchObject({
      metric_qty_max: 150,
    });
  });
});

describe('create', () => {
  it('defaults to private, owner = caller, grid for valid samples', () => {
    const { owner } = setup();
    const body = { ...clone(), visibility: undefined, view_mode: undefined };
    const r = okRecipe(createRecipeFor(db, owner, body));
    expect(r).toMatchObject({
      visibility: 'private',
      owner_id: owner.id,
      view_mode: 'grid',
      can_edit: true,
    });
    expect(r.sections[0]!.ingredients).toHaveLength(9);
    expect(r.sections[0]!.steps.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('two-section sample round-trips with split ids rewritten', () => {
    const { owner } = setup();
    const r = okRecipe(createRecipeFor(db, owner, SAMPLE_VANILLA_CAKE));
    const split = r.sections[0]!.ingredients.filter((i) => i.split_group_id);
    expect(split).toHaveLength(2);
    expect(split[0]!.split_group_id).toBe(split[1]!.split_group_id);
    expect(split[0]!.split_group_id).not.toBe('sugar');
    expect(r.sections).toHaveLength(2);
  });

  it('422 with field paths for invalid spans when view_mode is grid', () => {
    const { owner } = setup();
    const body = clone();
    body.sections[0].steps[3].row_end = 20;
    const res = createRecipeFor(db, owner, body);
    expect(res).toEqual({
      ok: false,
      status: 422,
      errors: [{ path: 'sections.0.steps.3.row_end', code: 'row_out_of_range' }],
    });
    expect(listRecipes(db, owner)).toHaveLength(0);
  });

  it('the same payload saves as list', () => {
    const { owner } = setup();
    const body = clone();
    body.sections[0].steps[3].row_end = 20;
    body.view_mode = 'list';
    expect(okRecipe(createRecipeFor(db, owner, body)).view_mode).toBe('list');
  });

  it('omitted view_mode falls back to list when a span is invalid or missing', () => {
    const body = clone();
    body.view_mode = undefined;
    body.sections[0].steps[2].row_start = null;
    body.sections[0].steps[2].row_end = null;
    expect(defaultViewMode(prepareRecipeInput(body))).toBe('list');
    const ok = prepareRecipe(body);
    expect(ok.ok && ok.tree.fields.viewMode).toBe('list');
    expect(defaultViewMode({ sections: [{ title: null, ingredients: [], steps: [] }] })).toBe(
      'list',
    );
  });

  it('missing span column with explicit grid reports span_required_for_grid', () => {
    const body = clone();
    body.sections[0].steps[2].row_start = null;
    body.sections[0].steps[2].row_end = null;
    const res = prepareRecipe(body);
    expect(res).toMatchObject({
      ok: false,
      status: 422,
      errors: [{ path: 'sections.0.steps.2.row_start', code: 'span_required_for_grid' }],
    });
  });

  it('rejects a split group that spans sections', () => {
    const body = structuredClone(SAMPLE_VANILLA_CAKE) as Loose;
    body.sections[1].ingredients[0].split_group_id = 'sugar';
    const res = prepareRecipe(body);
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect((res as { errors: unknown[] }).errors).toContainEqual({
      path: 'sections.1.ingredients.0.split_group_id',
      code: 'split_group_cross_section',
    });
  });

  it('zod errors become 422 field errors', () => {
    const { owner } = setup();
    const res = createRecipeFor(db, owner, { title: '', sections: [] });
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect((res as { errors: { path: string }[] }).errors.map((e) => e.path).sort()).toEqual([
      'sections',
      'title',
    ]);
  });

  it('fills raw_text when absent', () => {
    const { owner } = setup();
    const r = okRecipe(
      createRecipeFor(db, owner, {
        title: 'T',
        sections: [
          {
            ingredients: [{ name: 'flour', us_qty: 2, us_unit: 'cup', display_primary: 'us' }],
            steps: [],
          },
        ],
      }),
    );
    expect(r.sections[0]!.ingredients[0]!.raw_text).toBe('2 cup flour');
  });
});

function prepareRecipeInput(body: Loose) {
  return body as Parameters<typeof defaultViewMode>[0];
}

describe('authorization matrix', () => {
  it('private recipe: other gets 404 everywhere, admin can read and write', () => {
    const { owner, other, admin } = setup();
    const id = okRecipe(createRecipeFor(db, owner, clone())).id;
    expect(getRecipeFor(db, other, id)).toEqual({ ok: false, status: 404 });
    expect(updateRecipeFor(db, other, id, clone())).toEqual({ ok: false, status: 404 });
    expect(deleteRecipeFor(db, other, id)).toEqual({ ok: false, status: 404 });
    expect(setVisibilityFor(db, other, id, { visibility: 'users' })).toEqual({
      ok: false,
      status: 404,
    });
    expect(copyRecipeFor(db, other, id)).toEqual({ ok: false, status: 404 });

    const asAdmin = getRecipeFor(db, admin, id);
    expect(asAdmin.ok && asAdmin.recipe.can_edit).toBe(true);
    const upd = updateRecipeFor(db, admin, id, { ...clone(), title: 'By admin' });
    expect(upd.ok && upd.recipe.title).toBe('By admin');
    expect(upd.ok && upd.recipe.owner_id).toBe(owner.id);
  });

  it('users-visible recipe is read-only for non-owners (403 on write), 404 for nonexistent', () => {
    const { owner, other, admin } = setup();
    const id = okRecipe(createRecipeFor(db, owner, { ...clone(), visibility: 'users' })).id;
    const read = getRecipeFor(db, other, id);
    expect(read.ok && read.recipe.can_edit).toBe(false);
    expect(updateRecipeFor(db, other, id, clone())).toEqual({ ok: false, status: 403 });
    expect(deleteRecipeFor(db, other, id)).toEqual({ ok: false, status: 403 });
    expect(setVisibilityFor(db, other, id, { visibility: 'private' })).toEqual({
      ok: false,
      status: 403,
    });
    expect(getRecipeFor(db, other, 'missing')).toEqual({ ok: false, status: 404 });
    expect(deleteRecipeFor(db, admin, id).ok).toBe(true);
    expect(getRecipeFor(db, owner, id)).toEqual({ ok: false, status: 404 });
  });

  it('list: own + users-visible of others; admin gets no extra rows', () => {
    const { owner, other, admin } = setup();
    createRecipeFor(db, owner, clone());
    createRecipeFor(db, owner, { ...clone(), title: 'shared', visibility: 'users' });
    expect(listRecipes(db, other).map((r) => r.title)).toEqual(['shared']);
    expect(listRecipes(db, admin).map((r) => r.title)).toEqual(['shared']);
    expect(listRecipes(db, owner)).toHaveLength(2);
    expect(listRecipes(db, other)[0]).toMatchObject({
      owner_display_name: 'o@x.test',
      visibility: 'users',
    });
  });
});

describe('update', () => {
  it('replaces children; 422 leaves the stored recipe untouched', () => {
    const { owner } = setup();
    const id = okRecipe(createRecipeFor(db, owner, clone())).id;
    const bad = clone();
    bad.title = 'Changed';
    bad.sections[0].steps[4].row_start = 5;
    bad.sections[0].steps[4].row_end = 2;
    expect(updateRecipeFor(db, owner, id, bad)).toMatchObject({ ok: false, status: 422 });
    const same = getRecipeFor(db, owner, id);
    expect(same.ok && same.recipe.title).toBe('Mocha Skillet Cookie');

    const next = clone();
    next.sections = [{ ingredients: [{ name: 'only' }], steps: [] }];
    next.view_mode = undefined;
    const upd = updateRecipeFor(db, owner, id, next);
    expect(upd.ok && upd.recipe.sections[0]!.ingredients).toHaveLength(1);
    expect(upd.ok && upd.recipe.view_mode).toBe('list');
  });

  it('omitting visibility on update keeps the stored value', () => {
    const { owner } = setup();
    const id = okRecipe(createRecipeFor(db, owner, { ...clone(), visibility: 'users' })).id;
    const upd = updateRecipeFor(db, owner, id, { ...clone(), visibility: undefined });
    expect(upd.ok && upd.recipe.visibility).toBe('users');
  });

  it('omitted view_mode keeps a stored list, and recomputes a stored grid', () => {
    const { owner } = setup();
    const listBody = { ...clone(), view_mode: 'list' };
    const listId = okRecipe(createRecipeFor(db, owner, listBody)).id;
    const keep = updateRecipeFor(db, owner, listId, { ...clone(), view_mode: undefined });
    expect(keep.ok && keep.recipe.view_mode).toBe('list');
    const explicit = updateRecipeFor(db, owner, listId, { ...clone(), view_mode: 'grid' });
    expect(explicit.ok && explicit.recipe.view_mode).toBe('grid');
    const stays = updateRecipeFor(db, owner, listId, { ...clone(), view_mode: undefined });
    expect(stays.ok && stays.recipe.view_mode).toBe('grid');
    const broken = clone();
    broken.view_mode = undefined;
    broken.sections[0].steps[3].row_end = 99;
    const demoted = updateRecipeFor(db, owner, listId, broken);
    expect(demoted.ok && demoted.recipe.view_mode).toBe('list');
  });

  it('list-mode save of invalid spans succeeds, switching to grid then fails', () => {
    const { owner } = setup();
    const body = clone();
    body.view_mode = 'list';
    body.sections[0].steps[3].row_end = 99;
    const id = okRecipe(createRecipeFor(db, owner, body)).id;
    expect(updateRecipeFor(db, owner, id, { ...body, view_mode: 'grid' })).toMatchObject({
      ok: false,
      status: 422,
    });
  });
});

describe('visibility and copy', () => {
  it('owner sets visibility; bad value is 422', () => {
    const { owner } = setup();
    const id = okRecipe(createRecipeFor(db, owner, clone())).id;
    expect(setVisibilityFor(db, owner, id, { visibility: 'users' })).toEqual({
      ok: true,
      visibility: 'users',
    });
    expect(setVisibilityFor(db, owner, id, { visibility: 'public' })).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(setVisibilityFor(db, owner, id, {})).toMatchObject({ ok: false, status: 422 });
  });

  it('any reader can copy: private, owned by caller, copied_from set, independent', () => {
    const { owner, other } = setup();
    const id = okRecipe(createRecipeFor(db, owner, { ...clone(), visibility: 'users' })).id;
    const res = copyRecipeFor(db, other, id);
    expect(res.ok).toBe(true);
    const copyId = (res as { id: string }).id;
    const copy = getRecipeFor(db, other, copyId);
    expect(copy.ok && copy.recipe).toMatchObject({
      owner_id: other.id,
      visibility: 'private',
      copied_from_id: id,
      can_edit: true,
    });
    updateRecipeFor(db, other, copyId, { ...clone(), title: 'Mine now' });
    const orig = getRecipeFor(db, owner, id);
    expect(orig.ok && orig.recipe.title).toBe('Mocha Skillet Cookie');
    // The owner cannot see the copy (private).
    expect(getRecipeFor(db, owner, copyId)).toEqual({ ok: false, status: 404 });
  });

  it('deleting the original keeps the copy with copied_from_id null', () => {
    const { owner, other } = setup();
    const id = okRecipe(createRecipeFor(db, owner, { ...clone(), visibility: 'users' })).id;
    const copyId = (copyRecipeFor(db, other, id) as { id: string }).id;
    deleteRecipeFor(db, owner, id);
    const copy = getRecipeFor(db, other, copyId);
    expect(copy.ok && copy.recipe.copied_from_id).toBeNull();
  });
});

describe('deleteRecipeFor photo cleanup', () => {
  it('removes the recipe photo files, tolerating missing files and path escapes', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { insertCoverPhoto } = await import('@/lib/db/photos');
    const { photo } = await import('@/lib/db/schema');
    const { owner } = setup();
    const id = okRecipe(createRecipeFor(db, owner, clone())).id;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
    const outside = path.join(path.dirname(dir), `outside-${path.basename(dir)}.txt`);
    try {
      fs.writeFileSync(path.join(dir, 'a.webp'), 'x');
      fs.writeFileSync(outside, 'keep');
      insertCoverPhoto(db, id, { filePath: 'a.webp', width: 1, height: 1 });
      insertCoverPhoto(db, id, { filePath: 'gone.webp', width: 1, height: 1 });
      db.insert(photo)
        .values({ recipeId: id, filePath: `../${path.basename(outside)}`, width: 1, height: 1 })
        .run();
      expect(deleteRecipeFor(db, owner, id, { uploadsDir: dir }).ok).toBe(true);
      expect(fs.existsSync(path.join(dir, 'a.webp'))).toBe(false);
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  });
});

describe('derived alternate measure (T7)', () => {
  const withIngredients = (ings: Loose[]) => {
    const r = clone();
    r.sections = [{ title: null, ingredients: ings, steps: [] }];
    return r;
  };
  const ing = (o: Loose) => ({ display_primary: 'us', ...o });

  it('stores 115 g for 4 oz butter, keeps display_primary, round-trips through the API shape', () => {
    const { owner } = setup();
    const created = okRecipe(
      createRecipeFor(
        db,
        owner,
        withIngredients([ing({ name: 'unsalted butter', us_qty: 4, us_unit: 'oz' })]),
      ),
    );
    const got = okRecipe(getRecipeFor(db, owner, created.id) as never);
    const i = got.sections[0].ingredients[0];
    expect([i.metric_qty, i.metric_unit, i.us_qty, i.us_unit, i.display_primary]).toEqual([
      115,
      'g',
      4,
      'oz',
      'us',
    ]);
  });
  it('never overwrites an imported metric value (4 oz / 115 g stays 115)', () => {
    const { owner } = setup();
    const r = okRecipe(
      createRecipeFor(
        db,
        owner,
        withIngredients([
          ing({ name: 'butter', us_qty: 4, us_unit: 'oz', metric_qty: 113, metric_unit: 'g' }),
        ]),
      ),
    );
    expect(r.sections[0].ingredients[0].metric_qty).toBe(113);
  });
  it('replace re-derives after the primary quantity changes and is idempotent', () => {
    const { owner } = setup();
    const r = okRecipe(
      createRecipeFor(
        db,
        owner,
        withIngredients([ing({ name: 'butter', us_qty: 4, us_unit: 'oz' })]),
      ),
    );
    const edit = (q: number) =>
      okRecipe(
        updateRecipeFor(
          db,
          owner,
          r.id,
          withIngredients([ing({ name: 'butter', us_qty: q, us_unit: 'oz' })]),
        ) as never,
      ).sections[0].ingredients[0];
    expect(edit(6).metric_qty).toBe(170);
    const again = edit(6);
    expect([again.metric_qty, again.us_qty]).toEqual([170, 6]);
  });
  it('leaves counts and unknown units alone', () => {
    const { owner } = setup();
    const r = okRecipe(
      createRecipeFor(
        db,
        owner,
        withIngredients([
          ing({ name: 'large eggs', us_qty: 2 }),
          ing({ name: 'garlic', us_qty: 1, us_unit: 'clove' }),
        ]),
      ),
    );
    for (const i of r.sections[0].ingredients) {
      expect([i.metric_qty, i.metric_unit]).toEqual([null, null]);
    }
  });
});
