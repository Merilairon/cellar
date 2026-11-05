import { describe, expect, it } from 'vitest';
import { formatMeasure, formatQty } from './formatIngredient';

const m = (o: Partial<Parameters<typeof formatMeasure>[0]>) =>
  formatMeasure({
    metric_qty: null,
    metric_unit: null,
    us_qty: null,
    us_unit: null,
    display_primary: 'metric',
    ...o,
  });

describe('formatQty', () => {
  it('uses fraction glyphs', () => {
    expect(formatQty(0.5)).toBe('½');
    expect(formatQty(1.5)).toBe('1½');
    expect(formatQty(0.75)).toBe('¾');
    expect(formatQty(2 / 3)).toBe('⅔');
  });
  it('prints integers and trimmed decimals', () => {
    expect(formatQty(2)).toBe('2');
    expect(formatQty(115)).toBe('115');
    expect(formatQty(1.2)).toBe('1.2');
    expect(formatQty(0.07)).toBe('0.07');
  });
});

describe('formatMeasure', () => {
  it('shows primary first and the other in parentheses', () => {
    expect(m({ metric_qty: 115, metric_unit: 'g', us_qty: 4, us_unit: 'oz' })).toBe('115 g (4 oz)');
    expect(
      m({ metric_qty: 115, metric_unit: 'g', us_qty: 4, us_unit: 'oz', display_primary: 'us' }),
    ).toBe('4 oz (115 g)');
  });
  it('shows only the side that exists, without converting', () => {
    expect(m({ us_qty: 1, us_unit: 'cup', display_primary: 'metric' })).toBe('1 cup');
    expect(m({ metric_qty: 200, metric_unit: 'g', display_primary: 'us' })).toBe('200 g');
  });
  it('handles counts and empty', () => {
    expect(m({ metric_qty: 2 })).toBe('2');
    expect(m({})).toBe('');
  });
});
