// Free-text ingredient line <-> editor fields (G11, Q7). Pure: reuses the importer's parser and
// the display formatter, so the editor reads a line exactly as the recipe form does.

import type { EditorIngredient, TextPatch } from '@/lib/grid/editor';
import {
  MAX_INGREDIENT_LINE_CHARS,
  joinQtyRange,
  parseIngredientLine,
  toIngredientFields,
} from '@/lib/import/ingredient-parser';
import { formatMeasure } from '@/lib/units/display';

export const MAX_LINE = MAX_INGREDIENT_LINE_CHARS;

/** The text the inline field starts with: the line as written, else the primary measure + name. */
export function rowLine(i: EditorIngredient): string {
  if (i.raw_text) return i.raw_text;
  const p = i.display_primary === 'us' ? 'us' : 'metric';
  const qty = i[`${p}_qty`];
  return [qty != null ? joinQtyRange(qty, i[`${p}_qty_max`]) : null, i[`${p}_unit`], i.name]
    .filter((x) => x != null && x !== '')
    .join(' ');
}

export type ParsedRow =
  | { ok: false }
  | {
      ok: true;
      patch: TextPatch;
      /** True when no quantity could be read: the whole text became the name. */
      fallback: boolean;
      /** "3 tbsp · butter · softened" */
      preview: string;
    };

/** Parse a committed line. Empty text is not a row (the caller keeps the old text). */
export function parseRowText(text: string): ParsedRow {
  const line = text.trim().slice(0, MAX_LINE);
  if (!line) return { ok: false };
  const parsed = parseIngredientLine(line);
  const f = toIngredientFields(parsed);
  if (!f.name.trim()) return { ok: false };
  // Every field is supplied, so the other unit system is replaced, never left stale (C7).
  const patch: TextPatch = {
    name: f.name,
    note: f.note,
    raw_text: f.raw_text,
    metric_qty: f.metric_qty,
    metric_qty_max: f.metric_qty_max,
    metric_unit: f.metric_unit,
    us_qty: f.us_qty,
    us_qty_max: f.us_qty_max,
    us_unit: f.us_unit,
    display_primary: f.display_primary,
  };
  const measure = formatMeasure(f, { pref: f.display_primary });
  const preview = [measure, f.name, f.note].filter(Boolean).join(' · ');
  return { ok: true, patch, fallback: !!parsed.unparsed, preview };
}

/** 1-based position of a row inside its split group, with the group size; null when not split. */
export function portionOf(
  rows: EditorIngredient[],
  index: number,
): { n: number; total: number } | null {
  const g = rows[index]?.split_group;
  if (!g) return null;
  const members = rows.filter((r) => r.split_group === g);
  if (members.length < 2) return null;
  return { n: members.indexOf(rows[index]) + 1, total: members.length };
}
