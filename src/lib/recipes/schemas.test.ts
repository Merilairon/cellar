import { describe, expect, it } from 'vitest';
import { SAMPLE_SKILLET_COOKIES } from './samples';
import { recipeInputSchema, zodIssuesToErrors } from './schemas';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const base = () => structuredClone(SAMPLE_SKILLET_COOKIES) as Loose;
const errs = (v: unknown) => {
  const r = recipeInputSchema.safeParse(v);
  return r.success ? [] : zodIssuesToErrors(r.error);
};
const minimal = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  title: 'T',
  sections: [{ ingredients: [{ name: 'a' }, { name: 'b' }], steps }],
  ...extra,
});

describe('recipeInputSchema', () => {
  it('accepts the samples and applies defaults', () => {
    expect(errs(base())).toEqual([]);
    const r = recipeInputSchema.parse(minimal([]));
    expect(r.sections[0]!.ingredients[0]!.display_primary).toBe('metric');
    expect(r.visibility).toBeUndefined();
  });

  it('validates ingredient range bounds', () => {
    const ing = (o: Record<string, unknown>) => ({
      title: 'T',
      sections: [{ ingredients: [{ name: 'honey', ...o }], steps: [] }],
    });
    expect(errs(ing({ us_qty: 2, us_qty_max: 3, us_unit: 'tbsp' }))).toEqual([]);
    expect(errs(ing({ us_qty: 3, us_qty_max: 2 }))).toEqual([
      { path: 'sections.0.ingredients.0.us_qty_max', code: 'qty_range_order' },
    ]);
    expect(errs(ing({ metric_qty_max: 3 }))).toEqual([
      { path: 'sections.0.ingredients.0.metric_qty_max', code: 'qty_range_order' },
    ]);
  });

  it('rejects banner steps with spans', () => {
    const e = errs(minimal([{ kind: 'banner_top', label: 'x', row_start: 0, row_end: 0 }]));
    expect(e.map((x) => x.path)).toContain('sections.0.steps.0.row_start');
  });

  it('rejects a column without spans only when view_mode is grid', () => {
    const step = { kind: 'column', label: 'mix' };
    expect(errs(minimal([step], { view_mode: 'list' }))).toEqual([]);
    expect(errs(minimal([step]))).toEqual([]);
    expect(errs(minimal([step], { view_mode: 'grid' }))).toEqual([
      { path: 'sections.0.steps.0.row_start', code: 'span_required_for_grid' },
    ]);
  });

  it('rejects row_start > row_end and half-set spans', () => {
    expect(errs(minimal([{ kind: 'column', label: 'x', row_start: 2, row_end: 1 }]))).toEqual([
      { path: 'sections.0.steps.0.row_end', code: 'row_order' },
    ]);
    expect(errs(minimal([{ kind: 'column', label: 'x', row_start: 1 }]))).toEqual([
      { path: 'sections.0.steps.0.row_end', code: 'span_incomplete' },
    ]);
  });

  it('rejects a bad kind', () => {
    expect(errs(minimal([{ kind: 'sidebar', label: 'x' }])).length).toBeGreaterThan(0);
  });

  it('rejects empty sections and a missing title', () => {
    expect(errs({ title: 'T', sections: [] }).map((e) => e.path)).toEqual(['sections']);
    expect(errs({ sections: minimal([]).sections }).map((e) => e.path)).toEqual(['title']);
    expect(errs({ title: '   ', sections: minimal([]).sections }).map((e) => e.path)).toEqual([
      'title',
    ]);
  });

  it('allows only http(s) source URLs', () => {
    expect(errs(minimal([], { source_url: 'https://example.com/r' }))).toEqual([]);
    expect(errs(minimal([], { source_url: 'http://example.com' }))).toEqual([]);
    expect(errs(minimal([], { source_url: '' }))).toEqual([]);
    for (const u of ['javascript:alert(1)', 'ftp://x.test', 'file:///etc/passwd', 'not a url']) {
      expect(errs(minimal([], { source_url: u })).map((e) => e.path)).toEqual(['source_url']);
    }
  });

  it('rejects negative and non-finite numbers', () => {
    expect(errs(minimal([], { prep_minutes: -1 })).map((e) => e.path)).toEqual(['prep_minutes']);
    expect(errs(minimal([], { servings: 0 })).map((e) => e.path)).toEqual(['servings']);
    expect(errs(minimal([], { servings: -2 })).length).toBe(1);
    const s = minimal([]);
    (s.sections[0]!.ingredients[0] as Record<string, unknown>).metric_qty = -5;
    expect(errs(s).map((e) => e.path)).toEqual(['sections.0.ingredients.0.metric_qty']);
    expect(errs(minimal([{ kind: 'column', label: 'x', row_start: -1, row_end: 0 }])).length).toBe(
      1,
    );
    expect(
      errs(
        minimal([
          { kind: 'column', label: 'x', row_start: 0, row_end: 0, minutes_min: 9, minutes_max: 3 },
        ]),
      ),
    ).toEqual([{ path: 'sections.0.steps.0.minutes_max', code: 'minutes_order' }]);
  });

  it('rejects an invalid visibility and view_mode', () => {
    expect(errs(minimal([], { visibility: 'public' })).length).toBe(1);
    expect(errs(minimal([], { view_mode: 'cards' })).length).toBe(1);
  });
});
