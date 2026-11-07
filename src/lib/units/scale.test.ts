import { describe, expect, it } from 'vitest';
import {
  MAX_FACTOR,
  MIN_FACTOR,
  factorFromServings,
  normalizeFactor,
  scaleIngredient,
  scaleMeasure,
} from './scale';

const s = (qty: number, unit: string | null, factor: number, qtyMax?: number) =>
  scaleMeasure({ qty, qtyMax, unit }, factor)!;

describe('factors', () => {
  it.each([
    [2, 2],
    [0.5, 0.5],
    [0, 1],
    [-3, 1],
    [NaN, 1],
    [Infinity, 1],
    [1000, MAX_FACTOR],
    [0.0001, MIN_FACTOR],
  ])('normalizeFactor(%s) = %s', (f, expected) => {
    expect(normalizeFactor(f)).toBe(expected);
  });

  it.each([
    [4, 8, 2],
    [4, 2, 0.5],
    [6, 6, 1],
    [4, 1000, MAX_FACTOR],
  ])('factorFromServings(%s, %s) = %s', (base, target, expected) => {
    expect(factorFromServings(base, target)).toBe(expected);
  });

  it.each([
    [null, 4],
    [4, null],
    [0, 4],
    [4, 0],
    [4, -1],
    [NaN, 4],
  ])('factorFromServings(%s, %s) is null', (base, target) => {
    expect(factorFromServings(base as number | null, target as number | null)).toBeNull();
  });
});

describe('scaleMeasure', () => {
  it.each([
    [1 / 3, 'cup', 2, 2 / 3],
    [0.5, 'tsp', 0.5, 0.25],
    [0.25, 'tsp', 0.5, 0.125],
    [2, 'cup', 0.5, 1],
    [115, 'g', 2, 230],
    [4, 'oz', 2, 8],
    [200, 'g', 0.5, 100],
    [1, 'g', 0.5, 1],
    [250, 'mL', 3, 750],
    [2, null, 2, 4],
    [1, 'clove', 3, 3],
  ])('%s %s x%s -> %s', (qty, unit, factor, expected) => {
    expect(s(qty, unit, factor).qty).toBeCloseTo(expected, 9);
  });

  it('keeps a stored value as written at factor 1', () => {
    expect(s(113, 'g', 1)).toMatchObject({ qty: 113, approx: false });
    expect(s(3, null, 1)).toMatchObject({ qty: 3, approx: false });
  });

  it('scales both bounds of a range', () => {
    expect(s(2, 'tbsp', 2, 3)).toMatchObject({ qty: 4, qtyMax: 6 });
  });

  it('drops a range that collapses after rounding', () => {
    expect(s(1000, 'g', 1 / 100, 1001).qtyMax).toBeNull();
  });

  it('marks counts that become fractional (G15)', () => {
    expect(s(3, null, 0.5)).toMatchObject({ qty: 1.5, approx: true });
    expect(s(1, null, 0.5)).toMatchObject({ qty: 0.5, approx: true });
    expect(s(2, null, 2).approx).toBe(false);
    expect(s(3, 'clove', 1.5).approx).toBe(true);
  });

  it('marks values that moved by more than 2 percent', () => {
    expect(s(1, 'g', 0.5).approx).toBe(true); // 0.5 g shown as 1 g
    expect(s(113.398, 'g', 1.001).approx).toBe(false); // 113.5 -> 115 is 1.3 percent
    expect(s(230, 'g', 1.5).approx).toBe(false); // 345 exact
  });

  it('does not flag exact results', () => {
    expect(s(1 / 3, 'cup', 2).approx).toBe(false);
    expect(s(115, 'g', 2).approx).toBe(false);
  });

  it('returns null without a quantity', () => {
    expect(scaleMeasure({ qty: null, unit: 'g' }, 2)).toBeNull();
    expect(scaleMeasure({ qty: -1, unit: 'g' }, 2)).toBeNull();
  });

  it('treats invalid factors as unscaled', () => {
    expect(s(4, 'oz', NaN).qty).toBe(4);
    expect(s(4, 'oz', -2).qty).toBe(4);
    expect(s(4, 'oz', 0).qty).toBe(4);
  });

  it('clamps absurd factors', () => {
    expect(s(1, 'cup', 1e6).qty).toBe(100);
    expect(s(100, 'g', 1e-9).qty).toBe(1);
  });

  it('round-trips exact cases: x2 then x1/2', () => {
    for (const [q, u] of [
      [4, 'oz'],
      [115, 'g'],
      [0.5, 'tsp'],
      [1, 'cup'],
      [2, null],
      [1 / 3, 'cup'],
    ] as const) {
      expect(s(s(q, u, 2).qty, u, 0.5).qty).toBeCloseTo(q, 9);
    }
  });

  it('never throws and always yields a finite positive result over a grid', () => {
    const units = [
      null,
      'g',
      'mL',
      'kg',
      'tsp',
      'tbsp',
      'cup',
      'oz',
      'lb',
      'fl oz',
      'clove',
      'bogus',
    ];
    const qtys = [0, 1e-6, 0.01, 0.125, 1 / 3, 0.5, 1, 2.5, 10, 99, 1000, 12345];
    const factors = [0, -1, NaN, Infinity, 0.001, 0.01, 0.25, 0.5, 1, 1.5, 2, 3, 100, 500];
    for (const unit of units)
      for (const qty of qtys)
        for (const factor of factors) {
          const r = scaleMeasure({ qty, qtyMax: qty * 2, unit }, factor);
          expect(r).not.toBeNull();
          expect(Number.isFinite(r!.qty)).toBe(true);
          if (qty > 0) expect(r!.qty).toBeGreaterThan(0);
        }
  });
});

describe('scaleIngredient', () => {
  it('scales both stored sides independently', () => {
    const r = scaleIngredient({ metric: { qty: 115, unit: 'g' }, us: { qty: 4, unit: 'oz' } }, 2);
    expect(r.metric?.qty).toBe(230);
    expect(r.us?.qty).toBe(8);
  });
  it('keeps a missing side missing', () => {
    expect(scaleIngredient({ metric: null, us: { qty: 1, unit: 'cup' } }, 2)).toEqual({
      metric: null,
      us: { qty: 2, qtyMax: null, unit: 'cup', approx: false },
    });
  });
  it('only exposes quantity fields (no step, time or temperature input)', () => {
    const r = scaleIngredient({ metric: { qty: 1, unit: 'g' }, us: null }, 2);
    expect(Object.keys(r).sort()).toEqual(['metric', 'us']);
    expect(Object.keys(r.metric!).sort()).toEqual(['approx', 'qty', 'qtyMax', 'unit']);
  });
});
