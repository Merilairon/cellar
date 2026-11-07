import { describe, expect, it } from 'vitest';
import { roundMeasure, roundMetric, roundUs } from './round';

describe('roundMetric (G12)', () => {
  it.each([
    [0.2, 'g', 1],
    [0.5, 'g', 1],
    [1, 'g', 1],
    [4, 'g', 4],
    [4.4, 'g', 4],
    [9.6, 'g', 10],
    [10, 'g', 10],
    [12, 'g', 10],
    [13, 'g', 15],
    [113.398, 'g', 115],
    [226.796, 'g', 225],
    [230, 'g', 230],
    [997, 'g', 995],
    [999.9, 'g', 1000],
    [1000, 'g', 1000],
    [1234, 'g', 1230],
    [1236, 'g', 1240],
    [0.4, 'mL', 1],
    [7.4, 'mL', 7],
    [18, 'mL', 20],
    [236.588, 'mL', 235],
    [995, 'mL', 995],
    [1500, 'mL', 1500],
    [1503, 'mL', 1500],
    [0.254, 'kg', 0.25],
    [0.0001, 'kg', 0.01],
    [1.234, 'L', 1.23],
  ])('%s %s -> %s', (qty, unit, expected) => {
    expect(roundMetric(qty, unit).value).toBeCloseTo(expected, 9);
  });

  it('reports exact only when nothing moved', () => {
    expect(roundMetric(230, 'g').exact).toBe(true);
    expect(roundMetric(113.4, 'g').exact).toBe(false);
  });

  it('never rounds a positive value to 0', () => {
    for (const q of [1e-9, 0.01, 0.3, 0.49]) {
      expect(roundMetric(q, 'g').value).toBeGreaterThan(0);
      expect(roundMetric(q, 'mL').value).toBeGreaterThan(0);
      expect(roundMetric(q, 'kg').value).toBeGreaterThan(0);
    }
  });

  it('leaves zero alone and survives bad input', () => {
    expect(roundMetric(0, 'g')).toEqual({ value: 0, exact: true });
    expect(roundMetric(NaN, 'g').value).toBe(0);
  });
});

describe('roundUs (G12)', () => {
  it.each([
    [0.5, 'tsp', 0.5],
    [0.25, 'tsp', 0.25],
    [0.125, 'tsp', 0.125],
    [0.1, 'tsp', 0.125],
    [0.01, 'tsp', 0.125],
    [0.3, 'tsp', 1 / 3],
    [0.4, 'tsp', 3 / 8],
    [1.1, 'tsp', 1],
    [1.3, 'tsp', 4 / 3],
    [2.55, 'tsp', 2.5],
    [0.2, 'tbsp', 0.25],
    [1.9, 'tbsp', 2],
    [2.5, 'tbsp', 2.5],
    [1 / 3, 'cup', 1 / 3],
    [2 / 3, 'cup', 2 / 3],
    [0.4, 'cup', 1 / 3],
    [0.45, 'cup', 0.5],
    [1.1, 'cup', 1],
    [1.2, 'cup', 1.25],
    [0.05, 'cup', 0.125],
    [0.1, 'oz', 0.125],
    [0.6, 'oz', 0.5],
    [4, 'oz', 4],
    [4.2, 'oz', 4],
    [4.3, 'oz', 4.5],
    [8, 'oz', 8],
    [1.3, 'lb', 1.25],
    [0.4, 'lb', 0.5],
    [3.3, 'fl oz', 3.5],
    [1.1, 'qt', 1],
  ])('%s %s -> %s', (qty, unit, expected) => {
    expect(roundUs(qty, unit).value).toBeCloseTo(expected, 9);
  });

  it.each([
    [1.5, 1.5],
    [0.5, 0.5],
    [4, 4],
    [2.45, 2.5],
    [0.3, 1 / 3],
    [0.01, 0.125],
  ])('counts: %s -> %s', (qty, expected) => {
    expect(roundUs(qty, null).value).toBeCloseTo(expected, 9);
    expect(roundUs(qty, 'clove').value).toBeCloseTo(expected, 9);
  });

  it('never rounds a positive value to 0 (minimum 1/8)', () => {
    for (const unit of ['tsp', 'tbsp', 'cup', 'oz', 'lb', 'fl oz', null]) {
      for (const q of [1e-9, 0.001, 0.05])
        expect(roundUs(q, unit).value).toBeGreaterThanOrEqual(0.125);
    }
  });

  it('flags exactness', () => {
    expect(roundUs(0.5, 'cup').exact).toBe(true);
    expect(roundUs(1 / 3, 'cup').exact).toBe(true);
    expect(roundUs(0.4, 'cup').exact).toBe(false);
  });
});

describe('roundMeasure', () => {
  it('dispatches on the unit system', () => {
    expect(roundMeasure(113.4, 'g').value).toBe(115);
    expect(roundMeasure(4.2, 'oz').value).toBe(4);
    expect(roundMeasure(2.45, null).value).toBe(2.5);
  });
});
