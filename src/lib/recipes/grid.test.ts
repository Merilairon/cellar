import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { reindexRecipe } from '@/lib/db/fts';
import { user } from '@/lib/db/schema';
import { SAMPLE_SKILLET_COOKIES } from './samples';
import {
  createRecipeFor,
  getRecipeFor,
  setVisibilityFor,
  updateGridFor,
  updateRecipeFor,
} from './service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

let db: Db;
afterEach(() => {
  vi.useRealTimers();
  db.$client.close();
});
const mk = (email: string, role: 'admin' | 'member' = 'member') =>
  db.insert(user).values({ email, displayName: email, passwordHash: 'h', role }).returning().get();
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
  return { owner: mk('o@x.test'), other: mk('x@x.test'), admin: mk('a@x.test', 'admin') };
};
const clone = () => structuredClone(SAMPLE_SKILLET_COOKIES) as Loose;
const make = (actor: Loose, over: Loose = {}) => {
  const r = createRecipeFor(db, actor as never, { ...clone(), ...over });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.recipe;
};
const stripIds = (o: Loose): Loose =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'id' && k !== 'position'));
/** Grid body as the editor would send it: sections of the stored recipe, no ids. */
const bodyFrom = (r: ReturnType<typeof make>, edit?: (sections: Loose[]) => void): Loose => {
  const sections = r.sections.map((s) => ({
    title: s.title,
    ingredients: s.ingredients.map((x) => stripIds(x)),
    steps: s.steps.map((x) => stripIds(x)),
  }));
  edit?.(sections);
  return { base_updated_at: r.updated_at, sections };
};
const ok = (r: ReturnType<typeof updateGridFor>) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.recipe;
};
const snapshot = (id: string) => ({
  rows: ['recipe', 'section', 'ingredient', 'step', 'recipe_tag', 'recipe_fts'].map((t) =>
    db.$client.prepare(`select * from ${t}`).all(),
  ),
  id,
});

describe('updateGridFor: authorization', () => {
  it('owner 200, admin on another recipe 200', () => {
    const { owner, admin } = setup();
    const r = make(owner);
    expect(updateGridFor(db, owner, r.id, bodyFrom(r))).toMatchObject({ ok: true });
    const r2 = getRecipeFor(db, owner, r.id);
    if (!r2.ok) throw new Error();
    expect(updateGridFor(db, admin, r.id, bodyFrom(r2.recipe))).toMatchObject({ ok: true });
  });

  it('member on another users-visible recipe is 403, private is 404, missing is 404; nothing written', () => {
    const { owner, other } = setup();
    const shared = make(owner, { visibility: 'users' });
    const priv = make(owner, { visibility: 'private' });
    const before = snapshot('');
    expect(updateGridFor(db, other, shared.id, bodyFrom(shared))).toEqual({
      ok: false,
      status: 403,
    });
    expect(updateGridFor(db, other, priv.id, bodyFrom(priv))).toEqual({ ok: false, status: 404 });
    expect(updateGridFor(db, other, 'MISSING', bodyFrom(priv))).toEqual({
      ok: false,
      status: 404,
    });
    expect(snapshot('')).toEqual(before);
  });

  it('refusals do not depend on the body (invalid body from a read-only caller is still 403/404, no 422/409 leak)', () => {
    const { owner, other } = setup();
    const shared = make(owner, { visibility: 'users' });
    const priv = make(owner, { visibility: 'private' });
    expect(updateGridFor(db, other, shared.id, { nope: 1 })).toEqual({ ok: false, status: 403 });
    expect(updateGridFor(db, other, priv.id, { base_updated_at: 'stale', sections: [] })).toEqual({
      ok: false,
      status: 404,
    });
  });
});

describe('updateGridFor: persistence', () => {
  it('replaces sections only; recipe fields, tags and visibility stay', () => {
    const { owner } = setup();
    const r = make(owner, { tags: ['Cookies', 'Dessert'], visibility: 'users' });
    const out = ok(
      updateGridFor(
        db,
        owner,
        r.id,
        bodyFrom(r, (s) => {
          s[0].ingredients[0].name = 'cultured butter';
        }),
      ),
    );
    expect(out.sections[0]!.ingredients[0]!.name).toBe('cultured butter');
    expect(out).toMatchObject({
      title: r.title,
      description: r.description,
      servings: r.servings,
      prep_minutes: r.prep_minutes,
      source_name: r.source_name,
      visibility: 'users',
      tags: ['cookies', 'dessert'],
      created_at: r.created_at,
      can_edit: true,
    });
    expect(out.updated_at > r.updated_at).toBe(true);
  });

  it('rejects recipe fields, tags, view_mode and ids instead of ignoring them (strict)', () => {
    const { owner } = setup();
    const r = make(owner);
    for (const extra of [
      { title: 'x' },
      { tags: [] },
      { visibility: 'users' },
      { view_mode: 'list' },
      { id: r.id },
    ]) {
      const res = updateGridFor(db, owner, r.id, { ...bodyFrom(r), ...extra });
      expect(res).toMatchObject({ ok: false, status: 422 });
      expect(JSON.stringify(res)).toContain('unrecognized_keys');
    }
  });

  it('ignores extra keys inside ingredients/steps the same way as the recipe schema (ids dropped, view_mode never client-set)', () => {
    const { owner } = setup();
    const r = make(owner);
    // The full stored shape (with ids and positions) is accepted and ids are not trusted.
    const sections = structuredClone(r.sections);
    const out = ok(updateGridFor(db, owner, r.id, { base_updated_at: r.updated_at, sections }));
    expect(out.sections[0]!.ingredients[0]!.id).not.toBe(r.sections[0]!.ingredients[0]!.id);
  });

  it('rewrites split_group_id to fresh ULIDs, keeping shared groups shared', () => {
    const { owner } = setup();
    const r = make(owner);
    const out = ok(
      updateGridFor(
        db,
        owner,
        r.id,
        bodyFrom(r, (s) => {
          s[0].ingredients[0].split_group_id = 'client-key';
          s[0].ingredients[0].portion_label = 'half';
          s[0].ingredients[1].split_group_id = 'client-key';
          s[0].ingredients[1].portion_label = 'rest';
          s[0].ingredients[2].split_group_id = 'other-key';
        }),
      ),
    );
    const [a, b, c, d] = out.sections[0]!.ingredients;
    expect(a!.split_group_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a!.split_group_id).toBe(b!.split_group_id);
    expect(c!.split_group_id).not.toBe(a!.split_group_id);
    expect(c!.split_group_id).not.toBe('other-key');
    expect(d!.split_group_id).toBeNull();
    expect(a!.portion_label).toBe('half');
  });

  it('stores hostile text as data', () => {
    const { owner } = setup();
    const r = make(owner);
    const evil = '<img src=x onerror=alert(1)>';
    ok(
      updateGridFor(
        db,
        owner,
        r.id,
        bodyFrom(r, (s) => {
          s[0].ingredients[0].name = evil;
          s[0].steps[0].label = evil;
        }),
      ),
    );
    const got = getRecipeFor(db, owner, r.id);
    if (!got.ok) throw new Error();
    expect(got.recipe.sections[0]!.ingredients[0]!.name).toBe(evil);
    expect(got.recipe.sections[0]!.steps[0]!.label).toBe(evil);
  });

  it('keeps the FTS row equal to a fresh rebuild', () => {
    const { owner } = setup();
    const r = make(owner, { tags: ['cookies'] });
    ok(
      updateGridFor(
        db,
        owner,
        r.id,
        bodyFrom(r, (s) => {
          s[0].ingredients[0].name = 'quinceblossom';
        }),
      ),
    );
    const read = () => db.$client.prepare('select * from recipe_fts where recipe_id = ?').all(r.id);
    const fts = read();
    expect(JSON.stringify(fts)).toContain('quinceblossom');
    expect(JSON.stringify(fts)).toContain('cookies');
    reindexRecipe(db, r.id);
    expect(read()).toEqual(fts);
    expect(db.$client.prepare('select count(*) n from recipe_fts_defer').get()).toEqual({ n: 0 });
  });
});

describe('updateGridFor: validation (422) and warnings', () => {
  const cases: Array<[string, string, (s: Loose[]) => void]> = [
    ['row_out_of_range', 'sections.0.steps.2.row_end', (s) => (s[0].steps[2].row_end = 30)],
    [
      'row_order',
      'sections.0.steps.2.row_end',
      (s) => {
        s[0].steps[2].row_start = 4;
        s[0].steps[2].row_end = 2;
      },
    ],
    ['span_incomplete', 'sections.0.steps.2.row_end', (s) => (s[0].steps[2].row_end = null)],
    [
      'span_required_for_grid',
      'sections.0.steps.2.row_start',
      (s) => {
        s[0].steps[2].row_start = null;
        s[0].steps[2].row_end = null;
      },
    ],
    // Zod rejects a banner span first (z.null()), so the validator's banner_has_span is
    // unreachable over HTTP; the editor path parser must map invalid_type at steps.N.row_*.
    ['invalid_type', 'sections.0.steps.0.row_start', (s) => (s[0].steps[0].row_start = 1)],
    ['no_rows', 'sections.0.steps.2.row_start', (s) => (s[0].ingredients = [])],
    [
      'split_group_cross_section',
      'sections.1.ingredients.0.split_group_id',
      (s) => {
        s[0].ingredients[0].split_group_id = 'g';
        s.push({
          title: 'More',
          ingredients: [{ name: 'x', display_primary: 'metric', split_group_id: 'g' }],
          steps: [],
        });
      },
    ],
  ];
  it.each(cases)(
    '%s is reachable with the validator path and writes nothing',
    (code, path, edit) => {
      const { owner } = setup();
      const r = make(owner);
      const before = snapshot('');
      const res = updateGridFor(db, owner, r.id, bodyFrom(r, edit));
      expect(res).toMatchObject({ ok: false, status: 422 });
      if (res.ok || res.status !== 422) throw new Error();
      expect(res.errors).toContainEqual({ path, code });
      expect(snapshot('')).toEqual(before);
    },
  );

  it('missing, malformed and non-ISO base_updated_at are 422 on base_updated_at', () => {
    const { owner } = setup();
    const r = make(owner);
    for (const base of [undefined, 5, '', 'yesterday']) {
      const res = updateGridFor(db, owner, r.id, { ...bodyFrom(r), base_updated_at: base });
      expect(res).toMatchObject({ ok: false, status: 422 });
      if (res.ok || res.status !== 422) throw new Error();
      expect(res.errors[0]!.path).toBe('base_updated_at');
    }
  });

  it('enforces 1..20 sections, 200 ingredients, 100 steps with schema codes and paths', () => {
    const { owner } = setup();
    const r = make(owner);
    const e = (b: Loose) => {
      const res = updateGridFor(db, owner, r.id, b);
      if (res.ok || res.status !== 422) throw new Error(JSON.stringify(res));
      return res.errors;
    };
    const sec = { title: null, ingredients: [], steps: [] };
    expect(e({ base_updated_at: r.updated_at, sections: [] })[0]).toEqual({
      path: 'sections',
      code: 'too_small',
    });
    expect(
      e({ base_updated_at: r.updated_at, sections: Array.from({ length: 21 }, () => sec) })[0],
    ).toEqual({ path: 'sections', code: 'too_big' });
    expect(
      e({
        base_updated_at: r.updated_at,
        sections: [{ ...sec, ingredients: Array.from({ length: 201 }, () => ({ name: 'x' })) }],
      })[0],
    ).toEqual({ path: 'sections.0.ingredients', code: 'too_big' });
    expect(
      e({
        base_updated_at: r.updated_at,
        sections: [
          {
            ...sec,
            steps: Array.from({ length: 101 }, () => ({ kind: 'banner_top', label: 'x' })),
          },
        ],
      })[0],
    ).toEqual({ path: 'sections.0.steps', code: 'too_big' });
  });

  it('an uncovered row is a warning only: 200', () => {
    const { owner } = setup();
    const r = make(owner);
    const out = ok(
      updateGridFor(
        db,
        owner,
        r.id,
        bodyFrom(r, (s) => {
          s[0].steps = s[0].steps.slice(0, 3); // banners + melt (row 0 only)
        }),
      ),
    );
    expect(out.view_mode).toBe('grid');
  });
});

describe('updateGridFor: view_mode (G3)', () => {
  it('ignores a client view_mode; no column step becomes list; a column step makes grid again', () => {
    const { owner } = setup();
    const r = make(owner);
    const noCols = ok(
      updateGridFor(
        db,
        owner,
        r.id,
        bodyFrom(r, (s) => {
          s[0].steps = s[0].steps.filter((x: Loose) => x.kind !== 'column');
        }),
      ),
    );
    expect(noCols.view_mode).toBe('list');
    const again = ok(
      updateGridFor(
        db,
        owner,
        r.id,
        bodyFrom(noCols, (s) => {
          s[0].steps.push({ kind: 'column', label: 'all', detail: '', row_start: 0, row_end: 8 });
        }),
      ),
    );
    expect(again.view_mode).toBe('grid');
  });

  it('keeps a stored list recipe valid: a list recipe with a good column becomes grid (editor decides entry)', () => {
    const { owner } = setup();
    const r = make(owner, { view_mode: 'list' });
    expect(ok(updateGridFor(db, owner, r.id, bodyFrom(r))).view_mode).toBe('grid');
  });
});

describe('updateGridFor: conflicts (409)', () => {
  it('two saves with the same base: first 200, second 409 carrying the current updated_at', () => {
    const { owner } = setup();
    const r = make(owner);
    const body = bodyFrom(r);
    const first = ok(updateGridFor(db, owner, r.id, body));
    const before = snapshot('');
    expect(updateGridFor(db, owner, r.id, body)).toEqual({
      ok: false,
      status: 409,
      currentUpdatedAt: first.updated_at,
    });
    expect(snapshot('')).toEqual(before);
    // Save mine anyway: resend with the stamp from the 409.
    expect(
      updateGridFor(db, owner, r.id, { ...body, base_updated_at: first.updated_at }),
    ).toMatchObject({ ok: true });
  });

  it('a recipe-form PUT or a visibility change between load and save conflicts (G13)', () => {
    const { owner } = setup();
    const r = make(owner);
    const body = bodyFrom(r);
    expect(updateRecipeFor(db, owner, r.id, { ...clone(), title: 'Renamed' })).toMatchObject({
      ok: true,
    });
    expect(updateGridFor(db, owner, r.id, body)).toMatchObject({ ok: false, status: 409 });
    const r2 = getRecipeFor(db, owner, r.id);
    if (!r2.ok) throw new Error();
    const body2 = bodyFrom(r2.recipe);
    setVisibilityFor(db, owner, r.id, { visibility: 'users' });
    expect(updateGridFor(db, owner, r.id, body2)).toMatchObject({ ok: false, status: 409 });
  });

  // L1: with the clock frozen, a write in the same millisecond as the load must still move the
  // stamp, or a stale base would pass the compare.
  it('a recipe-form PUT or a visibility change in the same millisecond still conflicts (L1)', () => {
    const { owner } = setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const r = make(owner);
    const body = bodyFrom(r);
    expect(updateRecipeFor(db, owner, r.id, { ...clone(), title: 'Same ms' })).toMatchObject({
      ok: true,
    });
    expect(updateGridFor(db, owner, r.id, body)).toMatchObject({ ok: false, status: 409 });
    const r2 = getRecipeFor(db, owner, r.id);
    if (!r2.ok) throw new Error();
    const body2 = bodyFrom(r2.recipe);
    setVisibilityFor(db, owner, r.id, { visibility: 'users' });
    expect(updateGridFor(db, owner, r.id, body2)).toMatchObject({ ok: false, status: 409 });
    const r3 = getRecipeFor(db, owner, r.id);
    if (!r3.ok) throw new Error();
    expect(r3.recipe.updated_at > r2.recipe.updated_at).toBe(true);
  });

  it('a tag-only change on the recipe form also conflicts (the form PUT bumps updated_at)', () => {
    const { owner } = setup();
    const r = make(owner);
    const body = bodyFrom(r);
    updateRecipeFor(db, owner, r.id, { ...clone(), tags: ['new'] });
    expect(updateGridFor(db, owner, r.id, body)).toMatchObject({ ok: false, status: 409 });
  });
});

describe('updateGridFor: derived measures (C7)', () => {
  const one = (ing: Loose) => ({
    title: null,
    ingredients: [{ name: 'butter', display_primary: 'us', ...ing }],
    steps: [],
  });
  const put = (owner: Loose, r: ReturnType<typeof make>, ing: Loose) =>
    ok(
      updateGridFor(db, owner as never, r.id, {
        base_updated_at: r.updated_at,
        sections: [one(ing)],
      }),
    );

  it('re-derives the cleared side after a primary quantity change, never touching the primary', () => {
    const { owner } = setup();
    const r = make(owner);
    const a = put(owner, r, { us_qty: 4, us_unit: 'oz' });
    const i1 = a.sections[0]!.ingredients[0]!;
    expect([i1.metric_qty, i1.metric_unit]).toEqual([115, 'g']);
    const b = put(owner, a, { us_qty: 6, us_unit: 'oz' });
    const i2 = b.sections[0]!.ingredients[0]!;
    expect([i2.us_qty, i2.us_unit, i2.display_primary]).toEqual([6, 'oz', 'us']);
    expect(i2.metric_unit).toBe('g');
    expect(i2.metric_qty).toBeGreaterThan(165);
    expect(i2.metric_qty).toBeLessThan(175);
  });

  it('stores an unchanged ingredient byte for byte (both sides as sent)', () => {
    const { owner } = setup();
    const r = make(owner);
    const a = put(owner, r, { us_qty: 4, us_unit: 'oz', metric_qty: 113, metric_unit: 'g' });
    const i = a.sections[0]!.ingredients[0]!;
    expect([i.metric_qty, i.us_qty]).toEqual([113, 4]);
    const again = put(owner, a, { us_qty: 4, us_unit: 'oz', metric_qty: 113, metric_unit: 'g' });
    expect(again.sections[0]!.ingredients[0]).toMatchObject({ metric_qty: 113, us_qty: 4 });
  });

  it('documented client duty: a stale non-primary side that is sent is stored as sent', () => {
    const { owner } = setup();
    const r = make(owner);
    const a = put(owner, r, { us_qty: 6, us_unit: 'oz', metric_qty: 115, metric_unit: 'g' });
    const i = a.sections[0]!.ingredients[0]!;
    expect([i.us_qty, i.metric_qty]).toEqual([6, 115]);
  });
});

describe('updateGridFor: shape of 422 errors is mappable to editor paths', () => {
  it('uses dotted paths like sections.0.ingredients.1.name with stable codes only', () => {
    const { owner } = setup();
    const r = make(owner);
    const res = updateGridFor(
      db,
      owner,
      r.id,
      bodyFrom(r, (s) => {
        s[0].ingredients[1].name = '';
        s[0].steps[2].label = '';
      }),
    );
    if (res.ok || res.status !== 422) throw new Error();
    expect(res.errors).toEqual(
      expect.arrayContaining([
        { path: 'sections.0.ingredients.1.name', code: 'too_small' },
        { path: 'sections.0.steps.2.label', code: 'too_small' },
      ]),
    );
    for (const e of res.errors) expect(Object.keys(e).sort()).toEqual(['code', 'path']);
  });
});

describe('open item O2 (schema facts)', () => {
  it('a section may have zero ingredients and zero steps; a banner needs a non-empty label; a section title is optional', () => {
    const { owner } = setup();
    const r = make(owner);
    const empty = {
      base_updated_at: r.updated_at,
      sections: [{ title: null, ingredients: [], steps: [] }],
    };
    const out = ok(updateGridFor(db, owner, r.id, empty));
    expect(out.view_mode).toBe('list');
    expect(out.sections[0]).toMatchObject({ ingredients: [], steps: [] });
    const noLabel = {
      base_updated_at: out.updated_at,
      sections: [{ title: null, ingredients: [], steps: [{ kind: 'banner_top', label: '  ' }] }],
    };
    const res = updateGridFor(db, owner, r.id, noLabel);
    if (res.ok || res.status !== 422) throw new Error();
    expect(res.errors).toEqual([{ path: 'sections.0.steps.0.label', code: 'too_small' }]);
  });
});
