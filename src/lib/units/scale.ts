// Scaling math. Operates on quantities only; step text, times and temperatures are not
// part of this API and are never touched.

import { roundMeasure } from './round';
import { findUnit } from './units';

export const MIN_FACTOR = 1 / 100;
export const MAX_FACTOR = 100;

export type Measure = { qty: number | null; qtyMax?: number | null; unit: string | null };
export type ScaledMeasure = {
  qty: number;
  qtyMax: number | null;
  unit: string | null;
  approx: boolean;
};

/** Invalid (NaN, <= 0, Infinity) factors mean "unscaled" (1); the rest clamp to [1/100, 100]. */
export function normalizeFactor(factor: number): number {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));
}

/** target / base servings as a usable factor; `null` when either is missing or not positive. */
export function factorFromServings(
  base: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (base == null || target == null) return null;
  if (!Number.isFinite(base) || !Number.isFinite(target) || base <= 0 || target <= 0) return null;
  return normalizeFactor(target / base);
}

const APPROX_TOLERANCE = 0.02;

/**
 * Scale one measure and round it. At factor 1 a stored value is shown as stored (an
 * imported 113 g stays 113 g) unless `round` is set (derived values always round).
 * `approx` (G15): rounding moved the value by more than 2 percent, or a count became fractional.
 */
export function scaleMeasure(m: Measure, factor: number, round = false): ScaledMeasure | null {
  if (m.qty == null || !Number.isFinite(m.qty) || m.qty < 0) return null;
  const f = normalizeFactor(factor);
  const doRound = round || f !== 1;
  const isCount = findUnit(m.unit) === null;
  let approx = false;
  const one = (q: number): number => {
    const exact = q * f;
    if (!doRound) return exact;
    const r = roundMeasure(exact, m.unit).value;
    if (exact > 0 && Math.abs(r - exact) / exact > APPROX_TOLERANCE) approx = true;
    if (isCount && f !== 1 && !Number.isInteger(exact)) approx = true;
    return r;
  };
  const qty = one(m.qty);
  let qtyMax: number | null = null;
  if (m.qtyMax != null && Number.isFinite(m.qtyMax) && m.qtyMax > m.qty) {
    const hi = one(m.qtyMax);
    qtyMax = hi > qty ? hi : null;
  }
  return { qty, qtyMax, unit: m.unit, approx };
}

export type IngredientMeasures = { metric: Measure | null; us: Measure | null };
export type ScaledIngredient = { metric: ScaledMeasure | null; us: ScaledMeasure | null };

/** Scales both stored sides independently (115 g x2 = 230 g, 4 oz x2 = 8 oz). */
export function scaleIngredient(measures: IngredientMeasures, factor: number): ScaledIngredient {
  return {
    metric: measures.metric ? scaleMeasure(measures.metric, factor) : null,
    us: measures.us ? scaleMeasure(measures.us, factor) : null,
  };
}
