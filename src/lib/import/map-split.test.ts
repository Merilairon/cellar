import { describe, expect, it } from 'vitest';
import {
  isSplitCandidate,
  markerBefore,
  qtyBefore,
  resolveSplit,
  type SplitEvent,
} from './map-split';
import { tokenizeDetailed } from './text-tokens';
import type { IngredientInput } from '@/lib/recipes/schemas';

const ing = (o: Partial<IngredientInput>): IngredientInput => ({
  name: 'sugar',
  note: null,
  raw_text: null,
  metric_qty: null,
  metric_qty_max: null,
  metric_unit: null,
  us_qty: null,
  us_qty_max: null,
  us_unit: null,
  display_primary: 'metric',
  split_group_id: null,
  portion_label: null,
  group_label: null,
  ...o,
});

function marker(text: string, word = 'sugar') {
  const t = tokenizeDetailed(text);
  const i = t.tokens.findIndex((x) => x.w === word);
  return markerBefore(t, i);
}

describe('qtyBefore', () => {
  const rows: Array<[string, string, { qty: number; unit: string | null } | null]> = [
    ['add 2 tbsp of the sugar', 'sugar', { qty: 2, unit: 'tbsp' }],
    ['add 1/2 cup sugar', 'sugar', { qty: 0.5, unit: 'cup' }],
    ['add 1 1/2 cups sugar', 'sugar', { qty: 1.5, unit: 'cup' }],
    ['add 100 g sugar', 'sugar', { qty: 100, unit: 'g' }],
    ['add 2 eggs', 'eggs', { qty: 2, unit: null }],
    ['add the sugar', 'sugar', null],
    ['add a little sugar', 'sugar', null],
  ];
  it.each(rows)('%s', (text, word, want) => {
    const t = tokenizeDetailed(text);
    const i = t.tokens.findIndex((x) => x.w === word);
    expect(qtyBefore(t.text, t.tokens[i]!.start)).toEqual(want);
  });
});

describe('markerBefore', () => {
  it('half', () => expect(marker('Beat the butter with half of the sugar.').kind).toBe('half'));
  it('half the', () => expect(marker('Beat in half the sugar.').kind).toBe('half'));
  it('remaining', () => expect(marker('Fold in the remaining sugar.').kind).toBe('remaining'));
  it('rest of the', () => expect(marker('Add the rest of the sugar.').kind).toBe('remaining'));
  it('the other half', () =>
    expect(marker('Add the other half of the sugar.').kind).toBe('remaining'));
  it('quantity', () =>
    expect(marker('Add 2 tbsp of the sugar.')).toEqual({ kind: 'qty', qty: 2, unit: 'tbsp' }));
  it('none', () => expect(marker('Add the sugar.').kind).toBe('none'));
  it('a marker in another clause does not count', () => {
    expect(marker('Let the dough rest, then add the sugar.').kind).toBe('none');
  });
});

const ev = (step: number, marker: SplitEvent['marker']): SplitEvent => ({ step, marker });

describe('isSplitCandidate', () => {
  it('needs two distinct steps', () => {
    expect(isSplitCandidate(ing({}), [ev(1, { kind: 'half' }), ev(1, { kind: 'remaining' })])).toBe(
      false,
    );
  });
  it('half/remaining markers', () => {
    expect(isSplitCandidate(ing({}), [ev(1, { kind: 'half' }), ev(3, { kind: 'none' })])).toBe(
      true,
    );
  });
  it('divided note', () => {
    expect(
      isSplitCandidate(ing({ note: 'divided' }), [
        ev(1, { kind: 'none' }),
        ev(3, { kind: 'none' }),
      ]),
    ).toBe(true);
  });
  it('two explicit quantities', () => {
    const q = { kind: 'qty', qty: 2, unit: 'tbsp' } as const;
    expect(isSplitCandidate(ing({}), [ev(1, q), ev(3, q)])).toBe(true);
  });
  it('one quantity in a step plus a plain re-mention is not a split', () => {
    const q = { kind: 'qty', qty: 2, unit: null } as const;
    expect(isSplitCandidate(ing({}), [ev(1, q), ev(3, { kind: 'none' })])).toBe(false);
  });
});

describe('resolveSplit', () => {
  it('half then remaining halves each measure', () => {
    const r = resolveSplit(ing({ us_qty: 1, us_unit: 'cup', metric_qty: 200, metric_unit: 'g' }), [
      ev(1, { kind: 'half' }),
      ev(4, { kind: 'remaining' }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.portions.map((p) => p.label)).toEqual(['half', 'remaining']);
      expect(r.portions[0]!.fields).toMatchObject({ us_qty: 0.5, metric_qty: 100, raw_text: null });
      expect(r.portions[0]!.step).toBe(1);
      expect(r.portions[1]!.step).toBe(4);
    }
  });
  it('a quantity of exactly 1 with a count unit stays whole (unresolved)', () => {
    expect(
      resolveSplit(ing({ name: 'egg', metric_qty: 1 }), [
        ev(1, { kind: 'half' }),
        ev(2, { kind: 'remaining' }),
      ]).ok,
    ).toBe(false);
  });
  it('an even count halves', () => {
    expect(
      resolveSplit(ing({ name: 'egg', metric_qty: 4 }), [
        ev(1, { kind: 'half' }),
        ev(2, { kind: 'remaining' }),
      ]).ok,
    ).toBe(true);
  });
  it('no quantity at all still splits', () => {
    expect(resolveSplit(ing({}), [ev(1, { kind: 'half' }), ev(2, { kind: 'remaining' })]).ok).toBe(
      true,
    );
  });
  it('explicit quantities that add up', () => {
    const r = resolveSplit(ing({ us_qty: 4, us_unit: 'tbsp' }), [
      ev(1, { kind: 'qty', qty: 2, unit: 'tbsp' }),
      ev(3, { kind: 'qty', qty: 2, unit: 'tbsp' }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.portions.map((p) => p.label)).toEqual(['2 tbsp', '2 tbsp']);
      expect(r.portions.map((p) => p.fields.us_qty)).toEqual([2, 2]);
    }
  });
  it('a quantity then the remaining portion splits the rest', () => {
    const r = resolveSplit(ing({ us_qty: 4, us_unit: 'tbsp' }), [
      ev(1, { kind: 'qty', qty: 2, unit: 'tbsp' }),
      ev(3, { kind: 'remaining' }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.portions.map((p) => p.label)).toEqual(['2 tbsp', 'remaining']);
      expect(r.portions.map((p) => p.fields.us_qty)).toEqual([2, 2]);
    }
  });
  it('a quantity larger than the line then remaining is unresolved', () => {
    const r = resolveSplit(ing({ us_qty: 1, us_unit: 'tbsp' }), [
      ev(1, { kind: 'qty', qty: 2, unit: 'tbsp' }),
      ev(3, { kind: 'remaining' }),
    ]);
    expect(r.ok).toBe(false);
  });
  it('explicit quantities that do not add up are unresolved', () => {
    const r = resolveSplit(ing({ us_qty: 5, us_unit: 'tbsp' }), [
      ev(1, { kind: 'qty', qty: 2, unit: 'tbsp' }),
      ev(3, { kind: 'qty', qty: 2, unit: 'tbsp' }),
    ]);
    expect(r.ok).toBe(false);
  });
  it('mixed units are unresolved', () => {
    const r = resolveSplit(ing({ us_qty: 4, us_unit: 'tbsp' }), [
      ev(1, { kind: 'qty', qty: 2, unit: 'tbsp' }),
      ev(3, { kind: 'qty', qty: 2, unit: 'tsp' }),
    ]);
    expect(r.ok).toBe(false);
  });
  it('three mentions without quantities are unresolved', () => {
    expect(
      resolveSplit(ing({ us_qty: 1, us_unit: 'cup' }), [
        ev(1, { kind: 'half' }),
        ev(2, { kind: 'none' }),
        ev(3, { kind: 'remaining' }),
      ]).ok,
    ).toBe(false);
  });
  it('"some of the sugar" then "the rest" is unresolved', () => {
    expect(resolveSplit(ing({}), [ev(1, { kind: 'none' }), ev(2, { kind: 'remaining' })]).ok).toBe(
      false,
    );
  });
});
