// Display only. Never converts between unit systems: a missing side stays missing.

const FRACTIONS: Array<[number, string]> = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

export function formatQty(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac < 0.005) return String(whole);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.01) return whole > 0 ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(n * 100) / 100);
}

export type MeasureFields = {
  metric_qty: number | null;
  metric_unit: string | null;
  us_qty: number | null;
  us_unit: string | null;
  display_primary: 'metric' | 'us';
};

const measure = (qty: number | null, unit: string | null): string | null =>
  qty === null ? null : unit ? `${formatQty(qty)} ${unit}` : formatQty(qty);

/** Primary measure first, the other system in parentheses when both are stored. */
export function formatMeasure(i: MeasureFields): string {
  const metric = measure(i.metric_qty, i.metric_unit);
  const us = measure(i.us_qty, i.us_unit);
  const [first, second] = i.display_primary === 'us' ? [us, metric] : [metric, us];
  if (first && second) return `${first} (${second})`;
  return first ?? second ?? '';
}
