// Split-ingredient resolution (tasklist G8, data-model §3 step 5b). Pure functions.
// "half the sugar" in one step and "the remaining sugar" in another become two rows that
// share a temporary `split_group_id`, but only when the quantities are resolvable.

import type { IngredientInput } from '@/lib/recipes/schemas';
import type { Token, Tokenized } from './text-tokens';

export type PartialMarker =
  | { kind: 'half' }
  | { kind: 'remaining' }
  | { kind: 'qty'; qty: number; unit: string | null }
  | { kind: 'none' };

const UNIT_ALIASES: ReadonlyMap<string, string> = new Map([
  ['tbsp', 'tbsp'],
  ['tablespoon', 'tbsp'],
  ['tbs', 'tbsp'],
  ['tsp', 'tsp'],
  ['teaspoon', 'tsp'],
  ['cup', 'cup'],
  ['g', 'g'],
  ['gram', 'g'],
  ['kg', 'kg'],
  ['ml', 'mL'],
  ['l', 'L'],
  ['oz', 'oz'],
  ['ounce', 'oz'],
  ['lb', 'lb'],
  ['pound', 'lb'],
]);

function canonicalUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const w = raw.toLowerCase().replace('.', '');
  return UNIT_ALIASES.get(w) ?? UNIT_ALIASES.get(w.endsWith('s') ? w.slice(0, -1) : w) ?? null;
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isAlpha = (c: number): boolean => c >= 97 && c <= 122;

function readWordBack(text: string, end: number): { w: string; start: number } {
  let i = end;
  while (i > 0 && isAlpha(text.charCodeAt(i - 1))) i--;
  return { w: text.slice(i, end), start: i };
}

function skipSpacesBack(text: string, i: number): number {
  let j = i;
  while (j > 0 && i - j < 4 && text[j - 1] === ' ') j--;
  return j;
}

/** Parse "1/2", "1.5", "2", "1 1/2" ending exactly at `end` (spaces already skipped). */
function readNumberBack(text: string, end: number): { v: number; start: number } | null {
  const i = end;
  const groupStart = (from: number): number => {
    let j = from;
    while (
      j > 0 &&
      from - j < 8 &&
      (isDigit(text.charCodeAt(j - 1)) || text[j - 1] === '.' || text[j - 1] === '/')
    )
      j--;
    return j;
  };
  const g1 = groupStart(i);
  if (g1 === i) return null;
  const parse = (s: string): number => {
    const slash = s.indexOf('/');
    if (slash > 0) {
      const a = Number(s.slice(0, slash));
      const b = Number(s.slice(slash + 1));
      return b > 0 ? a / b : NaN;
    }
    return Number(s);
  };
  let v = parse(text.slice(g1, i));
  let start = g1;
  if (
    text.slice(g1, i).includes('/') &&
    g1 >= 2 &&
    text[g1 - 1] === ' ' &&
    isDigit(text.charCodeAt(g1 - 2))
  ) {
    const g0 = groupStart(g1 - 1);
    const whole = Number(text.slice(g0, g1 - 1));
    if (Number.isFinite(whole)) {
      v += whole;
      start = g0;
    }
  }
  return Number.isFinite(v) && v > 0 ? { v, start } : null;
}

/** An explicit quantity directly before a mention: "2 tbsp of the sugar", "1/2 cup sugar". */
export function qtyBefore(
  text: string,
  mentionStart: number,
): { qty: number; unit: string | null } | null {
  let i = skipSpacesBack(text, mentionStart);
  for (let hops = 0; hops < 4; hops++) {
    const { w, start } = readWordBack(text, i);
    if (w === 'of' || w === 'the') i = skipSpacesBack(text, start);
    else break;
  }
  let unit: string | null = null;
  const word = readWordBack(text, i);
  const canon = canonicalUnit(word.w);
  if (canon) {
    unit = canon;
    i = skipSpacesBack(text, word.start);
  }
  const num = readNumberBack(text, i);
  if (!num) return null;
  return { qty: num.v, unit };
}

/** Classify the words just before a mention (same clause, up to five tokens). */
export function markerBefore(t: Tokenized, tokenIndex: number): PartialMarker {
  const m: Token | undefined = t.tokens[tokenIndex];
  if (!m) return { kind: 'none' };
  const words: string[] = [];
  for (let j = tokenIndex - 1; j >= 0 && words.length < 5; j--) {
    const tk = t.tokens[j]!;
    if (tk.sent !== m.sent || tk.clause !== m.clause) break;
    words.push(tk.w);
  }
  const has = (w: string) => words.includes(w);
  if (has('remaining') || has('rest') || has('reserved') || (has('half') && has('other'))) {
    return { kind: 'remaining' };
  }
  if (has('half')) return { kind: 'half' };
  const q = qtyBefore(t.text, m.start);
  if (q) return { kind: 'qty', qty: q.qty, unit: q.unit };
  return { kind: 'none' };
}

export type SplitEvent = { step: number; marker: PartialMarker };

/** Is this ingredient a split candidate (G8)? Needs two distinct steps plus a partial marker. */
export function isSplitCandidate(
  ing: Pick<IngredientInput, 'note'>,
  events: SplitEvent[],
): boolean {
  if (new Set(events.map((e) => e.step)).size < 2) return false;
  const qtyEvents = events.filter((e) => e.marker.kind === 'qty').length;
  const partial = events.some((e) => e.marker.kind === 'half' || e.marker.kind === 'remaining');
  const divided = (ing.note ?? '').toLowerCase().includes('divided');
  return partial || divided || qtyEvents >= 2;
}

export type Portion = {
  label: string;
  /** Step index whose first mention opens this portion. */
  step: number;
  fields: Pick<
    IngredientInput,
    'metric_qty' | 'metric_qty_max' | 'us_qty' | 'us_qty_max' | 'raw_text'
  >;
};

export type SplitResolution = { ok: true; portions: Portion[] } | { ok: false };

const round2 = (n: number): number => Math.round(n * 100) / 100;

const MEASURE_UNITS = new Set(UNIT_ALIASES.values());

/** Distinct steps in order with the first marker of each step. */
function perStep(events: SplitEvent[]): SplitEvent[] {
  const seen = new Set<number>();
  const out: SplitEvent[] = [];
  for (const e of [...events].sort((a, b) => a.step - b.step)) {
    if (seen.has(e.step)) continue;
    seen.add(e.step);
    out.push(e);
  }
  return out;
}

function scaled(ing: IngredientInput, ratio: number) {
  const f = (v: number | null | undefined) => (v == null ? null : round2(v * ratio));
  return {
    metric_qty: f(ing.metric_qty),
    metric_qty_max: f(ing.metric_qty_max),
    us_qty: f(ing.us_qty),
    us_qty_max: f(ing.us_qty_max),
    raw_text: null,
  };
}

export function resolveSplit(ing: IngredientInput, events: SplitEvent[]): SplitResolution {
  const steps = perStep(events);
  if (steps.length < 2) return { ok: false };
  const isCount = (unit: string | null | undefined) =>
    canonicalUnit(unit) === null || !MEASURE_UNITS.has(canonicalUnit(unit) ?? '');
  // (a) exactly two portions: half, then the remaining half.
  if (
    steps.length === 2 &&
    steps[0]!.marker.kind === 'half' &&
    (steps[1]!.marker.kind === 'remaining' || steps[1]!.marker.kind === 'half')
  ) {
    for (const [q, u] of [
      [ing.metric_qty, ing.metric_unit],
      [ing.us_qty, ing.us_unit],
    ] as const) {
      if (q != null && isCount(u) && !(Number.isInteger(q) && q % 2 === 0)) return { ok: false };
    }
    const fields = scaled(ing, 0.5);
    return {
      ok: true,
      portions: [
        { label: 'half', step: steps[0]!.step, fields },
        { label: 'remaining', step: steps[1]!.step, fields: { ...fields } },
      ],
    };
  }
  // (a') an explicit quantity, then "the remaining ..." (the rest is total minus the quantity).
  if (
    steps.length === 2 &&
    steps[0]!.marker.kind === 'qty' &&
    steps[1]!.marker.kind === 'remaining'
  ) {
    const m = steps[0]!.marker;
    const sides: Array<[number | null | undefined, string | null | undefined]> = [
      [ing.us_qty, ing.us_unit],
      [ing.metric_qty, ing.metric_unit],
    ];
    const side = sides.find(([qty, u]) => qty != null && canonicalUnit(u) === m.unit);
    const total = side ? side[0]! : null;
    if (total === null || m.qty >= total) return { ok: false };
    return {
      ok: true,
      portions: [
        {
          label: `${round2(m.qty)}${m.unit ? ' ' + m.unit : ''}`.slice(0, 60),
          step: steps[0]!.step,
          fields: scaled(ing, m.qty / total),
        },
        { label: 'remaining', step: steps[1]!.step, fields: scaled(ing, (total - m.qty) / total) },
      ],
    };
  }
  // (b) explicit quantities in every step that add up to the line (within 2 percent).
  const qtys = steps.map((s) => s.marker);
  if (steps.length <= 4 && qtys.every((m) => m.kind === 'qty')) {
    const q = qtys as Array<{ kind: 'qty'; qty: number; unit: string | null }>;
    const unit = q[0]!.unit;
    if (!q.every((m) => m.unit === unit)) return { ok: false };
    const sum = q.reduce((a, m) => a + m.qty, 0);
    const sides: Array<[number | null | undefined, string | null | undefined]> = [
      [ing.us_qty, ing.us_unit],
      [ing.metric_qty, ing.metric_unit],
    ];
    const side = sides.find(([qty, u]) => qty != null && canonicalUnit(u) === unit);
    const total = side ? side[0]! : null;
    if (total === null || total <= 0 || Math.abs(sum - total) / total > 0.02) return { ok: false };
    return {
      ok: true,
      portions: q.map((m, i) => ({
        label: `${round2(m.qty)}${unit ? ' ' + unit : ''}`.slice(0, 60),
        step: steps[i]!.step,
        fields: scaled(ing, m.qty / sum),
      })),
    };
  }
  return { ok: false };
}
