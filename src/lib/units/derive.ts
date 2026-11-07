// Derive the missing alternate measure (used by display now and by the save path in T7).

import { convertAcross, convertWithin } from './convert';
import { findDensity } from './density';
import { findUnit, type UnitSystem } from './units';
import type { Measure } from './scale';

const conv = (q: number, from: string, to: string) => convertWithin(q, from, to);

/** US volume unit that reads naturally for a quantity in mL. */
const usVolumeFor = (ml: number): string => (ml < 15 ? 'tsp' : ml < 59 ? 'tbsp' : 'cup');

/**
 * The other-system equivalent of `m`, unrounded; `null` for counts, unknown units, units
 * already in the target system, or invalid input. Weight-measured goods with a density
 * (flour, sugar, butter) become grams in metric (1 cup flour -> 125 g); US output stays
 * oz/lb for mass and tsp/tbsp/cup for volume.
 */
export function deriveAlternate(
  m: Measure,
  target: UnitSystem,
  ingredientName: string,
): Measure | null {
  const def = findUnit(m.unit);
  if (!def || m.qty == null || !Number.isFinite(m.qty) || m.qty < 0 || def.system === target)
    return null;
  const unit = def.id;
  const row = findDensity(ingredientName);
  const range = (to: string, via: (q: number) => number | null): Measure | null => {
    const q = via(m.qty!);
    if (q === null) return null;
    const max = m.qtyMax != null && m.qtyMax > m.qty! ? via(m.qtyMax) : null;
    return { qty: q, qtyMax: max, unit: to };
  };
  if (target === 'metric') {
    if (def.dimension === 'mass') return range('g', (q) => conv(q, unit, 'g'));
    if (row?.measuredBy === 'weight')
      return range('g', (q) => convertAcross(q, unit, 'g', ingredientName, row));
    return range('mL', (q) => conv(q, unit, 'mL'));
  }
  if (def.dimension === 'mass') {
    // Liquids (milk, water, oil) read better by volume; everything else by oz/lb.
    if (row?.measuredBy === 'volume') {
      const u = usVolumeFor(conv(m.qty, unit, 'g')! / row.gPerMl);
      return range(u, (q) => convertAcross(q, unit, u, ingredientName, row));
    }
    const asLb = (conv(m.qty, unit, 'g') ?? 0) >= 453.59237;
    return range(asLb ? 'lb' : 'oz', (q) => conv(q, unit, asLb ? 'lb' : 'oz'));
  }
  const u = usVolumeFor(conv(m.qty, unit, 'mL')!);
  return range(u, (q) => conv(q, unit, u));
}
