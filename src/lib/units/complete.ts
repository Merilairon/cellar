// Fill the missing alternate measure of an ingredient at save/import time (T7).
// Pure: a stored side is never overwritten; `displayPrimary` is never changed.

import { deriveAlternate } from './derive';
import { roundMeasure } from './round';

export type IngredientSides = {
  name: string;
  metricQty: number | null;
  metricQtyMax: number | null;
  metricUnit: string | null;
  usQty: number | null;
  usQtyMax: number | null;
  usUnit: string | null;
};

const MAX_STORE_ERROR = 0.02;

/**
 * Friendly grid value only when it moves the exact value by at most 2 percent (4 oz butter
 * 113.4 g -> 115 g); otherwise the exact value to 1 decimal (1 tbsp sugar stays 12.5 g, not 15 g).
 * A stored value is later scaled, so a coarse stored value would multiply its own error.
 */
function storeRounded(exact: number, unit: string | null): number {
  const friendly = roundMeasure(exact, unit).value;
  if (friendly > 0 && Math.abs(friendly - exact) / exact <= MAX_STORE_ERROR) return friendly;
  return Math.round(exact * 10) / 10;
}

/**
 * If exactly one side carries a quantity and the other side is empty, derive the empty side
 * (within a dimension exactly, across dimensions only via the density table) and store it
 * (friendly grid within 2 percent of the exact value, else exact to 1 decimal). Returns the input object unchanged when nothing is determinable.
 */
export function completeMeasures<T extends IngredientSides>(i: T): T {
  const hasMetric = i.metricQty != null;
  const hasUs = i.usQty != null;
  if (hasMetric === hasUs) return i;
  const target = hasMetric ? 'us' : 'metric';
  const emptyUnit = hasMetric ? i.usUnit : i.metricUnit;
  const emptyMax = hasMetric ? i.usQtyMax : i.metricQtyMax;
  if (emptyUnit != null || emptyMax != null) return i;
  const src = hasMetric
    ? { qty: i.metricQty, qtyMax: i.metricQtyMax, unit: i.metricUnit }
    : { qty: i.usQty, qtyMax: i.usQtyMax, unit: i.usUnit };
  const d = deriveAlternate(src, target, i.name);
  if (!d || d.qty == null) return i;
  const qty = storeRounded(d.qty, d.unit);
  let qtyMax = d.qtyMax != null ? storeRounded(d.qtyMax, d.unit) : null;
  if (qty <= 0) return i;
  if (qtyMax != null && qtyMax <= qty) qtyMax = null;
  return target === 'us'
    ? { ...i, usQty: qty, usQtyMax: qtyMax, usUnit: d.unit }
    : { ...i, metricQty: qty, metricQtyMax: qtyMax, metricUnit: d.unit };
}
