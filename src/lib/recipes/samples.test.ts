import { describe, expect, it } from 'vitest';
import { isGridValid } from '@/lib/grid/validate';
import { recipeInputSchema } from './schemas';
import { SAMPLE_RECIPES, SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from './samples';

describe('sample fixtures', () => {
  it.each(SAMPLE_RECIPES.map((r) => [r.title, r] as const))(
    '%s passes zod and grid validation',
    (_t, r) => {
      const parsed = recipeInputSchema.safeParse(r);
      expect(parsed.success).toBe(true);
      expect(isGridValid(r)).toBe(true);
      expect(r.view_mode).toBe('grid');
    },
  );

  it('sample A structure', () => {
    const s = SAMPLE_SKILLET_COOKIES.sections[0]!;
    expect(SAMPLE_SKILLET_COOKIES.sections).toHaveLength(1);
    expect(s.ingredients).toHaveLength(9);
    expect(s.steps.filter((x) => x.kind === 'banner_top')).toHaveLength(2);
    const cols = s.steps.filter((x) => x.kind === 'column');
    expect(cols.map((x) => [x.row_start, x.row_end])).toEqual([
      [0, 0],
      [0, 3],
      [0, 4],
      [0, 8],
      [0, 8],
    ]);
    expect(cols[4]).toMatchObject({ temp_f: 350, temp_c: 170, minutes_min: 30, minutes_max: 40 });
  });

  it('sample B structure', () => {
    expect(SAMPLE_VANILLA_CAKE.sections).toHaveLength(2);
    const steps = SAMPLE_VANILLA_CAKE.sections.flatMap((s) => s.steps);
    expect(steps.filter((x) => x.kind === 'banner_bottom')).toHaveLength(1);
    const split = SAMPLE_VANILLA_CAKE.sections[0]!.ingredients.filter((i) => i.split_group_id);
    expect(split.map((i) => i.portion_label)).toEqual(['half', 'remaining']);
  });

  it('ingredients keep raw_text and dual units', () => {
    const butter = SAMPLE_SKILLET_COOKIES.sections[0]!.ingredients[0]!;
    expect(butter).toMatchObject({
      name: 'unsalted butter',
      us_qty: 4,
      metric_qty: 115,
      metric_unit: 'g',
    });
    expect(butter.raw_text).toBe('4 oz (115 g) unsalted butter');
  });
});
