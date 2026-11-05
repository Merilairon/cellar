import { describe, expect, it } from 'vitest';
import { SAMPLE_RECIPES, SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { buildSectionLayout } from './layout';
import { isGridValid, validateRecipeGrid, validateSection, type GridSection } from './validate';

const rows = (n: number, split?: Array<string | null>) =>
  Array.from({ length: n }, (_, i) => ({ split_group_id: split?.[i] ?? null }));
const col = (row_start: number | null, row_end: number | null) => ({
  kind: 'column' as const,
  row_start,
  row_end,
});
const sec = (n: number, steps: GridSection['steps']): GridSection => ({
  ingredients: rows(n),
  steps,
});

describe('validateSection', () => {
  it('accepts valid spans with no warnings', () => {
    expect(validateSection(sec(3, [col(0, 0), col(0, 2)]))).toEqual({ errors: [], warnings: [] });
  });

  it('rule 1: non-contiguous ingredient positions', () => {
    const s: GridSection = {
      ingredients: [{ position: 0 }, { position: 2 }, { position: 3 }],
      steps: [],
    };
    expect(validateSection(s, 'sections.0.').errors).toEqual([
      { path: 'sections.0.ingredients.2.position', code: 'positions_not_contiguous' },
    ]);
    const dup: GridSection = { ingredients: [{ position: 0 }, { position: 0 }], steps: [] };
    expect(validateSection(dup).errors[0]?.code).toBe('positions_not_contiguous');
  });

  it('rule 2: row_start > row_end', () => {
    expect(validateSection(sec(4, [col(3, 1)])).errors).toEqual([
      { path: 'steps.0.row_end', code: 'row_order' },
    ]);
  });

  it('rule 2: out-of-range spans', () => {
    expect(validateSection(sec(3, [col(0, 3)])).errors).toEqual([
      { path: 'steps.0.row_end', code: 'row_out_of_range' },
    ]);
    expect(validateSection(sec(3, [col(-1, 1)])).errors).toEqual([
      { path: 'steps.0.row_start', code: 'row_out_of_range' },
    ]);
    expect(validateSection(sec(3, [col(5, 6)])).errors.map((e) => e.path)).toEqual([
      'steps.0.row_start',
      'steps.0.row_end',
    ]);
  });

  it('rule 2: non-integer spans', () => {
    expect(validateSection(sec(3, [col(0.5, 1)])).errors[0]?.code).toBe('row_out_of_range');
  });

  it('rule 3: column step with no rows', () => {
    expect(validateSection(sec(0, [col(0, 0)])).errors).toEqual([
      { path: 'steps.0.row_start', code: 'no_rows' },
    ]);
    expect(validateSection(sec(3, [col(null, null)])).errors).toEqual([
      { path: 'steps.0.row_start', code: 'span_required_for_grid' },
    ]);
    expect(validateSection(sec(3, [col(1, null)])).errors).toEqual([
      { path: 'steps.0.row_end', code: 'span_incomplete' },
    ]);
  });

  it('banners with spans are errors; clean banners are fine', () => {
    expect(
      validateSection(sec(2, [{ kind: 'banner_top', row_start: 0, row_end: 0 }, col(0, 1)])).errors,
    ).toEqual([{ path: 'steps.0.row_start', code: 'banner_has_span' }]);
    expect(
      validateSection(sec(2, [{ kind: 'banner_bottom' }, { kind: 'banner_top' }, col(0, 1)]))
        .errors,
    ).toEqual([]);
  });

  it('rule 5: uncovered row is a warning, not an error', () => {
    const r = validateSection(sec(4, [col(0, 1)]), 'sections.1.');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      { path: 'sections.1.ingredients.2', code: 'row_uncovered' },
      { path: 'sections.1.ingredients.3', code: 'row_uncovered' },
    ]);
  });

  it('no column steps: no uncovered warnings (valid list-style section)', () => {
    expect(validateSection(sec(3, [{ kind: 'banner_top' }]))).toEqual({ errors: [], warnings: [] });
  });
});

describe('validateRecipeGrid', () => {
  it('rule 6: split group spanning sections', () => {
    const r = validateRecipeGrid({
      sections: [
        { ingredients: rows(2, ['g', null]), steps: [col(0, 1)] },
        { ingredients: rows(2, [null, 'g']), steps: [col(0, 1)] },
      ],
    });
    expect(r.errors).toEqual([
      { path: 'sections.1.ingredients.1.split_group_id', code: 'split_group_cross_section' },
    ]);
    expect(isGridValid({ sections: [] })).toBe(true);
  });

  it('split group inside one section is fine', () => {
    expect(
      isGridValid({ sections: [{ ingredients: rows(3, ['g', null, 'g']), steps: [col(0, 2)] }] }),
    ).toBe(true);
  });
});

describe('sample recipes', () => {
  it.each(SAMPLE_RECIPES.map((r) => [r.title, r] as const))('%s validates clean', (_t, r) => {
    expect(validateRecipeGrid(r)).toEqual({ errors: [], warnings: [] });
  });

  it('mutated copy of sample A fails with the expected path/code', () => {
    const m = structuredClone(SAMPLE_SKILLET_COOKIES);
    const steps = m.sections[0]!.steps;
    const target = steps.findIndex((s) => s.kind === 'column' && s.row_end === 3);
    (steps[target] as { row_end: number }).row_end = 12;
    expect(validateRecipeGrid(m).errors).toEqual([
      { path: `sections.0.steps.${target}.row_end`, code: 'row_out_of_range' },
    ]);
  });

  it('sample B split pair shares a group inside the cake section', () => {
    const cake = SAMPLE_VANILLA_CAKE.sections[0]!;
    const split = cake.ingredients.filter((i) => i.split_group_id);
    expect(split).toHaveLength(2);
    expect(split[0]!.split_group_id).toBe(split[1]!.split_group_id);
  });
});

describe('buildSectionLayout', () => {
  it('sample A: 2 top banners, 9 rows, spans 1/4/5/9/9, banners consume no column', () => {
    const s = SAMPLE_SKILLET_COOKIES.sections[0]!;
    const l = buildSectionLayout(s.ingredients.length, s.steps);
    expect(l.bannersTop).toHaveLength(2);
    expect(l.bannersBottom).toHaveLength(0);
    expect(l.rowCount).toBe(9);
    expect(l.columns.map((c) => c.rowSpan)).toEqual([1, 4, 5, 9, 9]);
    expect(l.columns.map((c) => [c.rowStart, c.rowEnd])).toEqual([
      [0, 0],
      [0, 3],
      [0, 4],
      [0, 8],
      [0, 8],
    ]);
    expect(l.columns.map((c) => c.columnIndex)).toEqual([0, 1, 2, 3, 4]);
    // Row 0 has all five step cells; row 1 has none (all covered by spans) except the melt column is empty.
    expect(l.rows[0]!.filter((c) => c.type === 'step')).toHaveLength(5);
    expect(l.rows[1]!.map((c) => c.type)).toEqual(['empty']);
    expect(l.rows[4]!.map((c) => c.type)).toEqual(['empty', 'empty']);
    expect(l.rows[8]!.map((c) => c.type)).toEqual(['empty', 'empty', 'empty']);
  });

  it('orders by position within a kind and ignores steps without usable spans', () => {
    const steps = [
      { kind: 'column' as const, position: 2, row_start: 0, row_end: 1 },
      { kind: 'banner_bottom' as const, position: 4 },
      { kind: 'column' as const, position: 1, row_start: 0, row_end: 0 },
      { kind: 'column' as const, position: 3, row_start: null, row_end: null },
      { kind: 'banner_top' as const, position: 0 },
    ];
    const l = buildSectionLayout(2, steps);
    expect(l.columns.map((c) => c.step.position)).toEqual([1, 2]);
    expect(l.bannersTop).toHaveLength(1);
    expect(l.bannersBottom).toHaveLength(1);
  });

  it('sample B frosting section has a bottom banner after its columns', () => {
    const s = SAMPLE_VANILLA_CAKE.sections[1]!;
    const l = buildSectionLayout(s.ingredients.length, s.steps);
    expect(l.bannersBottom).toHaveLength(1);
    expect(l.columns).toHaveLength(2);
  });
});
