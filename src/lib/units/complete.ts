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

/**
 * If exactly one side carries a quantity and the other side is empty, derive the empty side
 * (within a dimension exactly, across dimensions only via the density table) and round it
 * for storage. Returns the input object unchanged when nothing is determinable.
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
  const qty = roundMeasure(d.qty, d.unit).value;
  let qtyMax = d.qtyMax != null ? roundMeasure(d.qtyMax, d.unit).value : null;
  if (qty <= 0) return i;
  if (qtyMax != null && qtyMax <= qty) qtyMax = null;
  return target === 'us'
    ? { ...i, usQty: qty, usQtyMax: qtyMax, usUnit: d.unit }
    : { ...i, metricQty: qty, metricQtyMax: qtyMax, metricUnit: d.unit };
}
