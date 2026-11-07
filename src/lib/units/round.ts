// Friendly rounding per the approved G12 table. Pure; a positive quantity never becomes 0.

import { findUnit } from './units';

export type Rounded = {
  value: number;
  /** True when rounding did not change the quantity. */ exact: boolean;
};

const EPS = 1e-9;
const finish = (qty: number, value: number): Rounded => ({
  value,
  exact: Math.abs(value - qty) <= EPS * Math.max(1, Math.abs(qty)),
});

const stepRound = (qty: number, step: number): number => Math.round(qty / step) * step;

/** Grams: <10 -> 1, 10..<1000 -> 5, >=1000 -> 10. mL is the same table. kg and L: 2 decimals. */
export function roundMetric(qty: number, unit: string | null): Rounded {
  if (!Number.isFinite(qty) || qty <= 0)
    return { value: Number.isFinite(qty) ? qty : 0, exact: Number.isFinite(qty) };
  const id = findUnit(unit)?.id;
  if (id === 'kg' || id === 'L') return finish(qty, Math.max(0.01, Math.round(qty * 100) / 100));
  const step = qty < 10 ? 1 : qty < 1000 ? 5 : 10;
  return finish(qty, Math.max(1, stepRound(qty, step)));
}

type Grid = { step: number; thirds: boolean };

/** Candidate fractions are multiples of `step`, plus thirds where allowed, never below 1/8. */
function snap(qty: number, belowOne: Grid, atLeastOne: Grid): number {
  const g = qty < 1 ? belowOne : atLeastOne;
  let best = Math.max(g.step, stepRound(qty, g.step));
  if (g.thirds) {
    const t = Math.round(qty * 3) / 3;
    if (t > 0 && Math.abs(t - qty) < Math.abs(best - qty)) best = t;
  }
  if (Math.abs(0.125 - qty) < Math.abs(best - qty)) best = 0.125;
  return best;
}

const US_GRIDS: Record<string, [Grid, Grid]> = {
  tsp: [
    { step: 1 / 8, thirds: true },
    { step: 1 / 4, thirds: true },
  ],
  tbsp: [
    { step: 1 / 8, thirds: true },
    { step: 1 / 4, thirds: true },
  ],
  cup: [
    { step: 1 / 4, thirds: true },
    { step: 1 / 4, thirds: true },
  ],
  oz: [
    { step: 1 / 4, thirds: false },
    { step: 1 / 2, thirds: false },
  ],
  'fl oz': [
    { step: 1 / 4, thirds: false },
    { step: 1 / 2, thirds: false },
  ],
  lb: [
    { step: 1 / 4, thirds: false },
    { step: 1 / 4, thirds: false },
  ],
  pt: [
    { step: 1 / 4, thirds: false },
    { step: 1 / 4, thirds: false },
  ],
  qt: [
    { step: 1 / 4, thirds: false },
    { step: 1 / 4, thirds: false },
  ],
  gal: [
    { step: 1 / 4, thirds: false },
    { step: 1 / 4, thirds: false },
  ],
};
/** Counts and unknown units (eggs, cloves, cans). */
const COUNT_GRID: [Grid, Grid] = [
  { step: 1 / 4, thirds: true },
  { step: 1 / 4, thirds: true },
];

/** US units (and counts when `unit` is null or unknown) snap to friendly fractions. */
export function roundUs(qty: number, unit: string | null): Rounded {
  if (!Number.isFinite(qty) || qty <= 0)
    return { value: Number.isFinite(qty) ? qty : 0, exact: Number.isFinite(qty) };
  const def = findUnit(unit);
  const [lo, hi] = (def && US_GRIDS[def.id]) || COUNT_GRID;
  return finish(qty, snap(qty, lo, hi));
}

/** Dispatch on the unit's system; counts and unknown units use the count grid. */
export function roundMeasure(qty: number, unit: string | null): Rounded {
  return findUnit(unit)?.system === 'metric' ? roundMetric(qty, unit) : roundUs(qty, unit);
}
