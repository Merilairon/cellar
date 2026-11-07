import { describe, expect, it } from 'vitest';
import { deriveAlternate } from './derive';
import { formatMeasure, formatQty, measureParts, type MeasureFields } from './display';

const base: MeasureFields = {
  name: 'unsalted butter',
  metric_qty: 115,
  metric_unit: 'g',
  us_qty: 4,
  us_unit: 'oz',
};
const f = (
  o: Partial<MeasureFields>,
  pref: 'metric' | 'us',
  extra: { scale?: number; toggle?: 'metric' | 'us' | null } = {},
) => formatMeasure({ ...base, ...o }, { pref, ...extra });

describe('named acceptance cases', () => {
  it('(a) 4 oz butter with unit_pref metric displays 115 g (stored metric wins)', () => {
    const parts = measureParts(base, { pref: 'metric' });
    expect(parts.primary).toMatchObject({ qty: 115, unit: 'g' });
    expect(f({}, 'metric')).toBe('115 g (4 oz)');
  });

  it('(a) fallback: 4 oz butter with no stored metric derives 115 g after rounding', () => {
    const parts = measureParts(
      { ...base, metric_qty: null, metric_unit: null },
      { pref: 'metric' },
    );
    expect(parts.primary).toMatchObject({ qty: 115, unit: 'g' });
    expect(f({ metric_qty: null, metric_unit: null }, 'metric')).toBe('115 g (4 oz)');
  });

  it('(b) scaled x2 displays 8 oz (230 g) for the us preference', () => {
    expect(f({}, 'us', { scale: 2 })).toBe('8 oz (230 g)');
  });

  it('(b) scaled x2 displays 230 g (8 oz) for the metric preference', () => {
    expect(f({}, 'metric', { scale: 2 })).toBe('230 g (8 oz)');
  });
});

describe('formatQty', () => {
  it.each([
    [0.5, '½'],
    [1.5, '1½'],
    [0.75, '¾'],
    [2 / 3, '⅔'],
    [1 / 3, '⅓'],
    [0.125, '⅛'],
    [2, '2'],
    [115, '115'],
    [1.2, '1.2'],
    [0.07, '0.07'],
  ])('%s -> %s', (n, s) => {
    expect(formatQty(n)).toBe(s);
  });
});

describe('formatMeasure', () => {
  it('uses the pref as primary and the other side in parentheses', () => {
    expect(f({}, 'us')).toBe('4 oz (115 g)');
  });
  it('the per-recipe toggle wins over the preference', () => {
    expect(f({}, 'metric', { toggle: 'us' })).toBe('4 oz (115 g)');
    expect(f({}, 'us', { toggle: 'metric' })).toBe('115 g (4 oz)');
    expect(f({}, 'us', { toggle: null })).toBe('4 oz (115 g)');
  });
  it('shows a stored value as written at scale 1', () => {
    expect(f({ metric_qty: 113 }, 'metric')).toBe('113 g (4 oz)');
  });
  it('prints counts without a unit', () => {
    expect(
      f({ name: 'eggs', metric_qty: 2, metric_unit: null, us_qty: null, us_unit: null }, 'us'),
    ).toBe('2');
  });
  it('1/3 cup x2 = ⅔ cup', () => {
    expect(
      f(
        { name: 'milk', metric_qty: null, metric_unit: null, us_qty: 1 / 3, us_unit: 'cup' },
        'us',
        { scale: 2 },
      ),
    ).toMatch(/^⅔ cup/);
  });
  it('1/2 tsp x1/2 = ¼ tsp and 1/4 tsp x1/2 = ⅛ tsp', () => {
    const t = (q: number) =>
      f({ name: 'salt', metric_qty: null, metric_unit: null, us_qty: q, us_unit: 'tsp' }, 'us', {
        scale: 0.5,
      });
    expect(t(0.5)).toMatch(/^¼ tsp/);
    expect(t(0.25)).toMatch(/^⅛ tsp/);
  });
  it('3 eggs x1/2 = ≈ 1½', () => {
    expect(
      f(
        { name: 'large eggs', metric_qty: 3, metric_unit: null, us_qty: null, us_unit: null },
        'metric',
        { scale: 0.5 },
      ),
    ).toBe('≈ 1½');
  });
  it('2 eggs x2 = 4 without ≈', () => {
    expect(
      f({ name: 'eggs', metric_qty: 2, metric_unit: null, us_qty: null, us_unit: null }, 'metric', {
        scale: 2,
      }),
    ).toBe('4');
  });
  it('ranges scale both bounds: 2-3 tbsp x2 = 4-6 tbsp', () => {
    const out = f(
      {
        name: 'oil',
        metric_qty: null,
        metric_unit: null,
        us_qty: 2,
        us_qty_max: 3,
        us_unit: 'tbsp',
      },
      'us',
      { scale: 2 },
    );
    expect(out.startsWith('4-6 tbsp')).toBe(true);
    expect(
      measureParts(
        { ...base, metric_qty: null, metric_unit: null, us_qty: 2, us_qty_max: 3, us_unit: 'tbsp' },
        { pref: 'us', scale: 2 },
      ).range,
    ).toBe(true);
  });
  it('derives a missing side for flour by weight: 1 cup flour -> 125 g', () => {
    expect(
      f(
        {
          name: 'all-purpose flour',
          metric_qty: null,
          metric_unit: null,
          us_qty: 1,
          us_unit: 'cup',
        },
        'metric',
      ),
    ).toBe('125 g (1 cup)');
  });
  it('does not derive across dimensions for an unknown ingredient', () => {
    expect(
      f(
        { name: 'mystery', metric_qty: null, metric_unit: null, us_qty: 1, us_unit: 'cup' },
        'metric',
      ),
    ).toBe('235 mL (1 cup)');
  });
  it('a count on the metric side is shown even when us is preferred', () => {
    expect(
      f(
        { name: 'cloves garlic', metric_qty: 3, metric_unit: 'clove', us_qty: null, us_unit: null },
        'us',
      ),
    ).toBe('3 clove');
  });
  it('returns an empty string for an empty ingredient', () => {
    expect(f({ metric_qty: null, metric_unit: null, us_qty: null, us_unit: null }, 'metric')).toBe(
      '',
    );
  });
  it('marks ≈ on the side that was approximated', () => {
    const out = f(
      { name: 'yeast', metric_qty: 1, metric_unit: 'g', us_qty: null, us_unit: null },
      'metric',
      { scale: 0.5 },
    );
    expect(out.startsWith('≈ 1 g')).toBe(true);
  });
  it('kg prints decimals, not fractions', () => {
    expect(
      f({ name: 'x', metric_qty: 1.25, metric_unit: 'kg', us_qty: null, us_unit: null }, 'metric', {
        scale: 1,
      }).startsWith('1.25 kg'),
    ).toBe(true);
  });
});

describe('deriveAlternate', () => {
  it('oz -> g and lb -> g stay unrounded', () => {
    expect(deriveAlternate({ qty: 4, unit: 'oz' }, 'metric', 'butter')).toMatchObject({
      unit: 'g',
    });
    expect(deriveAlternate({ qty: 4, unit: 'oz' }, 'metric', 'butter')!.qty).toBeCloseTo(
      113.398,
      3,
    );
  });
  it('g -> oz below a pound, lb from a pound up', () => {
    expect(deriveAlternate({ qty: 100, unit: 'g' }, 'us', 'rice')!.unit).toBe('oz');
    expect(deriveAlternate({ qty: 500, unit: 'g' }, 'us', 'rice')!.unit).toBe('lb');
  });
  it('mL -> tsp/tbsp/cup by size', () => {
    expect(deriveAlternate({ qty: 5, unit: 'mL' }, 'us', 'x')!.unit).toBe('tsp');
    expect(deriveAlternate({ qty: 30, unit: 'mL' }, 'us', 'x')!.unit).toBe('tbsp');
    expect(deriveAlternate({ qty: 250, unit: 'mL' }, 'us', 'x')!.unit).toBe('cup');
  });
  it('liquid grams with a density become a volume: 240 g milk -> cup', () => {
    const r = deriveAlternate({ qty: 244, unit: 'g' }, 'us', 'milk')!;
    expect(r.unit).toBe('cup');
    expect(r.qty).toBeCloseTo(1.0013, 3);
  });
  it('converts range bounds', () => {
    expect(deriveAlternate({ qty: 1, qtyMax: 2, unit: 'oz' }, 'metric', 'x')!.qtyMax).toBeCloseTo(
      56.699,
      3,
    );
  });
  it('null for counts, same system and bad input', () => {
    expect(deriveAlternate({ qty: 2, unit: null }, 'us', 'eggs')).toBeNull();
    expect(deriveAlternate({ qty: 2, unit: 'clove' }, 'metric', 'garlic')).toBeNull();
    expect(deriveAlternate({ qty: 2, unit: 'oz' }, 'us', 'x')).toBeNull();
    expect(deriveAlternate({ qty: NaN, unit: 'oz' }, 'metric', 'x')).toBeNull();
  });
});
