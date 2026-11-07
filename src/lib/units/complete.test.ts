import { describe, expect, it } from 'vitest';
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
});
