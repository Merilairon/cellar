import { describe, expect, it } from 'vitest';
import { deriveAlternate } from './derive';
import { scaleMeasure } from './scale';
import { completeMeasures, type IngredientSides } from './complete';

const base: IngredientSides = {
  name: 'x',
  metricQty: null,
  metricQtyMax: null,
  metricUnit: null,
  usQty: null,
  usQtyMax: null,
  usUnit: null,
};
const us = (name: string, qty: number, unit: string, max: number | null = null) => ({
  ...base,
  name,
  usQty: qty,
  usQtyMax: max,
  usUnit: unit,
});
const metric = (name: string, qty: number, unit: string, max: number | null = null) => ({
  ...base,
  name,
  metricQty: qty,
  metricQtyMax: max,
  metricUnit: unit,
});

describe('completeMeasures', () => {
  it('4 oz unsalted butter -> 115 g (113.4 rounded to the 5 g step)', () => {
    const r = completeMeasures(us('unsalted butter', 4, 'oz'));
    expect(r.metricQty).toBe(115);
    expect(r.metricUnit).toBe('g');
    expect(r.usQty).toBe(4);
  });
  it('1 cup flour -> about 125 g', () => {
    expect(completeMeasures(us('flour', 1, 'cup')).metricQty).toBe(125);
  });
  it('no density: 1 cup chopped walnuts gets no alternate (volume only goes to mL)', () => {
    const r = completeMeasures(us('chopped walnuts', 1, 'cup'));
    expect(r.metricUnit).not.toBe('g');
  });
  it('2-3 tbsp oil stores both bounds on the derived side', () => {
    const r = completeMeasures(us('oil', 2, 'tbsp', 3));
    expect(r.metricQty).toBeGreaterThan(0);
    expect(r.metricQtyMax).toBeGreaterThan(r.metricQty!);
  });
  it('metric-only side derives the US side', () => {
    const r = completeMeasures(metric('butter', 115, 'g'));
    expect(r.usUnit).toBe('oz');
    expect(r.usQty).toBe(4);
  });
  it.each([
    ['2 large eggs', { ...base, name: 'large eggs', usQty: 2 }],
    ['1 clove garlic', { ...base, name: 'garlic', usQty: 1, usUnit: 'clove' }],
    ['pinch of salt', { ...base, name: 'salt' }],
  ])('%s is untouched', (_n, ing) => {
    expect(completeMeasures(ing)).toBe(ing);
  });
  it('never overwrites a stored side', () => {
    const ing = { ...us('butter', 4, 'oz'), metricQty: 113, metricUnit: 'g' };
    expect(completeMeasures(ing)).toBe(ing);
  });
  it('is idempotent', () => {
    const once = completeMeasures(us('butter', 4, 'oz'));
    expect(completeMeasures(once)).toBe(once);
  });
  it.each([
    ['1 tbsp sugar', us('sugar', 1, 'tbsp'), 12.5],
    ['3 tbsp sugar', us('sugar', 3, 'tbsp'), 37.5],
    ['2 tbsp honey', us('honey', 2, 'tbsp'), 42],
  ])('%s keeps the exact derived value when the grid would move it by more than 2%%', (_n, ing, g) => {
    const r = completeMeasures(ing);
    expect(r.metricUnit).toBe('g');
    expect(r.metricQty).toBeCloseTo(g, 1);
    expect(Math.abs(r.metricQty! - g) / g).toBeLessThanOrEqual(0.005);
  });
  it('stores at most one decimal on the exact path', () => {
    const q = completeMeasures(us('sugar', 1, 'tbsp')).metricQty!;
    expect(q).toBe(Math.round(q * 10) / 10);
  });
  it('rounds to the friendly grid only when the change is within 2%', () => {
    for (const [name, qty, unit] of [
      ['sugar', 1, 'cup'],
      ['flour', 1, 'cup'],
      ['sugar', 1, 'tbsp'],
      ['sugar', 3, 'tbsp'],
      ['honey', 2, 'tbsp'],
      ['butter', 4, 'oz'],
      ['butter', 2, 'tbsp'],
      ['flour', 4, 'cup'],
      ['sugar', 1, 'tsp'],
    ] as const) {
      const r = completeMeasures(us(name, qty, unit));
      const exact = deriveAlternate({ qty, unit }, 'metric', name)!.qty!;
      expect(Math.abs(r.metricQty! - exact) / exact, `${qty} ${unit} ${name}`).toBeLessThanOrEqual(
        0.02,
      );
    }
  });
  it('a stored exact derived side does not multiply a rounded error when scaled', () => {
    const r = completeMeasures(us('sugar', 1, 'tbsp'));
    const s = scaleMeasure({ qty: r.metricQty, unit: r.metricUnit }, 2)!;
    expect(Math.abs(s.qty - 25) / 25).toBeLessThanOrEqual(0.02);
  });
  it('US side derived from metric obeys the same bound', () => {
    const r = completeMeasures(metric('sugar', 37.5, 'g'));
    const exact = deriveAlternate({ qty: 37.5, unit: 'g' }, 'us', 'sugar')!;
    expect(r.usUnit).toBe(exact.unit);
    expect(Math.abs(r.usQty! - exact.qty!) / exact.qty!).toBeLessThanOrEqual(0.02);
  });
});
