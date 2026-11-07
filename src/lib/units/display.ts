// Display formatting for one ingredient: primary measure first, the other in parentheses.
// Unit symbols are data (g, mL, oz, tbsp ...), not translated copy.

import { deriveAlternate } from './derive';
import { scaleMeasure, type Measure, type ScaledMeasure } from './scale';
import { findUnit, type UnitSystem } from './units';

export type MeasureFields = {
  name?: string;
  metric_qty: number | null;
  metric_qty_max?: number | null;
  metric_unit: string | null;
  us_qty: number | null;
  us_qty_max?: number | null;
  us_unit: string | null;
  display_primary?: UnitSystem;
};

export type DisplayOptions = {
  /** The user's unit preference. */
  pref: UnitSystem;
  /** Scale factor (1 = as written). */
  scale?: number;
  /** Per-recipe toggle; wins over `pref` when set. */
  toggle?: UnitSystem | null;
};

export type MeasurePart = {
  qty: number;
  qtyMax: number | null;
  unit: string | null;
  approx: boolean;
};
export type MeasureParts = {
  primary: MeasurePart | null;
  secondary: MeasurePart | null;
  approx: boolean;
  range: boolean;
};

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

/** Same output as the recipe component's `formatQty` (fraction glyphs, trimmed decimals). */
export function formatQty(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac < 0.005) return String(whole);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.01) return whole > 0 ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(n * 100) / 100);
}

const fmtNum = (n: number, unit: string | null): string =>
  findUnit(unit)?.system === 'metric' ? String(Math.round(n * 100) / 100) : formatQty(n);

function toPart(s: ScaledMeasure): MeasurePart {
  return { qty: s.qty, qtyMax: s.qtyMax, unit: s.unit, approx: s.approx };
}

/** Structured form: stored sides scaled, a missing side derived (and rounded) when possible. */
export function measureParts(i: MeasureFields, opts: DisplayOptions): MeasureParts {
  const factor = opts.scale ?? 1;
  const wanted: UnitSystem = opts.toggle ?? opts.pref;
  const other: UnitSystem = wanted === 'metric' ? 'us' : 'metric';
  const stored: Record<UnitSystem, Measure | null> = {
    metric:
      i.metric_qty == null
        ? null
        : { qty: i.metric_qty, qtyMax: i.metric_qty_max ?? null, unit: i.metric_unit },
    us: i.us_qty == null ? null : { qty: i.us_qty, qtyMax: i.us_qty_max ?? null, unit: i.us_unit },
  };
  const side = (sys: UnitSystem, from: UnitSystem): MeasurePart | null => {
    const m = stored[sys];
    if (m) return toPart(scaleMeasure(m, factor)!);
    const src = stored[from];
    const derived = src ? deriveAlternate(src, sys, i.name ?? '') : null;
    const s = derived ? scaleMeasure(derived, factor, true) : null;
    return s ? toPart(s) : null;
  };
  let primary = side(wanted, other);
  let secondary = side(other, wanted);
  // Counts and unknown units live on one stored side only: show it as primary.
  if (!primary && secondary) [primary, secondary] = [secondary, null];
  return {
    primary,
    secondary,
    approx: !!(primary?.approx || secondary?.approx),
    range: !!(primary?.qtyMax != null || secondary?.qtyMax != null),
  };
}

function partText(p: MeasurePart): string {
  const amount =
    p.qtyMax != null
      ? `${fmtNum(p.qty, p.unit)}-${fmtNum(p.qtyMax, p.unit)}`
      : fmtNum(p.qty, p.unit);
  const body = p.unit ? `${amount} ${p.unit}` : amount;
  return p.approx ? `≈ ${body}` : body;
}

/** "8 oz (230 g)"; the secondary side is omitted when it does not exist. */
export function formatMeasure(i: MeasureFields, opts: DisplayOptions): string {
  const { primary, secondary } = measureParts(i, opts);
  if (!primary) return '';
  return secondary ? `${partText(primary)} (${partText(secondary)})` : partText(primary);
}
