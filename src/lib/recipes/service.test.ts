import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
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
