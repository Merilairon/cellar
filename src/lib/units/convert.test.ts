import { describe, expect, it } from 'vitest';
import { convertAcross, convertRange, convertWithin } from './convert';

// qty, from, to, expected, digits of precision
const WITHIN: Array<[number, string, string, number, number]> = [
  [4, 'oz', 'g', 113.398, 3],
  [1, 'oz', 'g', 28.3495, 3],
  [8, 'oz', 'g', 226.796, 3],
  [1, 'lb', 'g', 453.592, 3],
  [2, 'lb', 'kg', 0.907185, 5],
  [1, 'kg', 'lb', 2.20462, 4],
  [500, 'g', 'oz', 17.637, 3],
  [1000, 'g', 'kg', 1, 9],
  [1, 'kg', 'g', 1000, 9],
  [1, 'lb', 'oz', 16, 9],
  [1, 'cup', 'mL', 236.588, 3],
  [250, 'mL', 'cup', 1.05669, 4],
  [1, 'tbsp', 'mL', 14.7868, 4],
  [1, 'tsp', 'mL', 4.92892, 4],
  [3, 'tsp', 'tbsp', 1, 9],
  [16, 'tbsp', 'cup', 1, 9],
  [48, 'tsp', 'cup', 1, 9],
  [8, 'fl oz', 'cup', 1, 9],
  [1, 'fl oz', 'mL', 29.5735, 4],
  [1, 'L', 'mL', 1000, 9],
  [1, 'L', 'cup', 4.22675, 4],
  [2, 'pt', 'qt', 1, 9],
  [4, 'qt', 'gal', 1, 9],
  [1, 'gal', 'L', 3.78541, 4],
  [0, 'oz', 'g', 0, 9],
  [0.001, 'g', 'oz', 0.000035274, 9],
  [1e9, 'g', 'kg', 1e6, 3],
  [1 / 3, 'cup', 'mL', 78.8627, 3],
  [2 / 3, 'cup', 'mL', 157.725, 3],
  [1 / 8, 'tsp', 'mL', 0.616115, 5],
  [1.5, 'tbsp', 'tsp', 4.5, 9],
  [5, 'g', 'g', 5, 9],
  [3, 'cup', 'cup', 3, 9],
  [15, 'ml', 'tbsp', 1.01442, 4],
  [100, 'g', 'lb', 0.220462, 5],
];

describe('convertWithin', () => {
  it.each(WITHIN)('%s %s -> %s', (qty, from, to, expected, digits) => {
    expect(convertWithin(qty, from, to)).toBeCloseTo(expected, digits);
  });

  it('4 oz is the exact 113.398... g, not the rounded 115', () => {
    expect(convertWithin(4, 'oz', 'g')).toBeCloseTo(113.398, 3);
    expect(convertWithin(4, 'oz', 'g')).not.toBe(115);
  });

  it.each(['g', 'oz', 'cup', 'tsp', 'mL', 'kg', 'lb', 'tbsp'])(
    'round-trips through the other system (%s)',
    (unit) => {
      const other = {
        g: 'oz',
        oz: 'g',
        cup: 'mL',
        tsp: 'mL',
        mL: 'cup',
        kg: 'lb',
        lb: 'kg',
        tbsp: 'mL',
      }[unit]!;
      const there = convertWithin(7.25, unit, other)!;
      expect(convertWithin(there, other, unit)).toBeCloseTo(7.25, 9);
    },
  );

  it.each([
    ['unknown source', 1, 'banana', 'g'],
    ['unknown target', 1, 'g', 'banana'],
    ['count unit', 2, 'clove', 'g'],
    ['mass to volume', 1, 'g', 'mL'],
    ['volume to mass', 1, 'cup', 'oz'],
    ['negative', -1, 'g', 'oz'],
    ['NaN', NaN, 'g', 'oz'],
    ['Infinity', Infinity, 'g', 'oz'],
  ] as const)('returns null for %s', (_label, qty, from, to) => {
    expect(convertWithin(qty, from, to)).toBeNull();
  });
});

describe('convertRange', () => {
  it('converts both bounds', () => {
    const r = convertRange(2, 3, 'tbsp', 'mL')!;
    expect(r.min).toBeCloseTo(29.5735, 3);
    expect(r.max).toBeCloseTo(44.3603, 3);
  });
  it('returns null when either bound is invalid', () => {
    expect(convertRange(2, NaN, 'tbsp', 'mL')).toBeNull();
    expect(convertRange(2, 3, 'tbsp', 'oz')).toBeNull();
  });
});

describe('convertAcross', () => {
  it.each([
    [1, 'cup', 'g', 'all-purpose flour', 125],
    [1, 'cup', 'g', 'flour', 125],
    [1, 'cup', 'g', 'unsalted butter', 227],
    [1, 'cup', 'g', 'granulated sugar', 200],
    [1, 'cup', 'g', 'light brown sugar', 213],
    [1, 'cup', 'g', 'powdered sugar', 120],
    [1, 'cup', 'g', 'cocoa powder', 85],
    [1, 'cup', 'g', 'water', 236.588],
    [100, 'mL', 'g', 'honey', 142],
  ])('%s %s of %s -> %s g', (qty, from, to, name, expected) => {
    expect(convertAcross(qty, from, to, name)).toBeCloseTo(expected, 2);
  });

  it('100 g sugar is about half a cup', () => {
    expect(convertAcross(100, 'g', 'cup', 'sugar')).toBeCloseTo(0.5, 6);
  });
  it('converts mass to volume units too (125 g flour -> tbsp)', () => {
    expect(convertAcross(125, 'g', 'tbsp', 'flour')).toBeCloseTo(16, 6);
  });
  it('same dimension needs no density', () => {
    expect(convertAcross(4, 'oz', 'g', 'mystery')).toBeCloseTo(113.398, 3);
  });
  it('is null across dimensions without a density', () => {
    expect(convertAcross(1, 'cup', 'g', 'mystery spice')).toBeNull();
  });
  it.each([
    'flour tortillas',
    'butter beans',
    'sugar snap peas',
    'milk chocolate',
    'coconut milk',
    'peanut butter',
  ])('is null for the false-positive name %s', (name) => {
    expect(convertAcross(1, 'cup', 'g', name)).toBeNull();
  });
  it('is null for unknown units and bad input', () => {
    expect(convertAcross(1, 'handful', 'g', 'flour')).toBeNull();
    expect(convertAcross(-1, 'cup', 'g', 'flour')).toBeNull();
  });
});
