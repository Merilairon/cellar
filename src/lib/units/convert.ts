// Exact (unrounded) conversion. Rounding for display lives in round.ts (G13).

import { findDensity, type DensityRow } from './density';
import { findUnit, type Dimension, type UnitSystem } from './units';

export function dimensionOf(unit: string | null | undefined): Dimension | null {
  return findUnit(unit)?.dimension ?? null;
}

export function systemOf(unit: string | null | undefined): UnitSystem | null {
  return findUnit(unit)?.system ?? null;
}

const validQty = (q: number): boolean => typeof q === 'number' && Number.isFinite(q) && q >= 0;

/** Convert inside one dimension. `null` for unknown units, mixed dimensions or bad input. */
export function convertWithin(qty: number, from: string, to: string): number | null {
  if (!validQty(qty)) return null;
  const a = findUnit(from);
  const b = findUnit(to);
  if (!a || !b || a.dimension !== b.dimension) return null;
  if (a === b) return qty;
  return (qty * a.factor) / b.factor;
}

export function convertRange(
  min: number,
  max: number,
  from: string,
  to: string,
): { min: number; max: number } | null {
  const lo = convertWithin(min, from, to);
  const hi = convertWithin(max, from, to);
  return lo === null || hi === null ? null : { min: lo, max: hi };
}

/**
 * Convert between mass and volume through an ingredient density. Same-dimension requests
 * need no density. `null` when the ingredient has no (safe) density row.
 */
export function convertAcross(
  qty: number,
  from: string,
  to: string,
  ingredientName: string,
  row: DensityRow | null = findDensity(ingredientName),
): number | null {
  if (!validQty(qty)) return null;
  const a = findUnit(from);
  const b = findUnit(to);
  if (!a || !b) return null;
  if (a.dimension === b.dimension) return convertWithin(qty, from, to);
  if (!row) return null;
  const canonical = qty * a.factor;
  const converted = a.dimension === 'volume' ? canonical * row.gPerMl : canonical / row.gPerMl;
  return converted / b.factor;
}
