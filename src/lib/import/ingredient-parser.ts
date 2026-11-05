// Pure module: no node, db or react imports. Runs on the client (live preview)
// and on the server. No unit conversion happens here, ever (see data-model §4, M5+).

export type UnitSystem = 'metric' | 'us';

export type ParsedIngredient = {
  qty: number | null;
  /** Upper bound of a range ("2-3"); `qty` holds the lower bound. */
  qtyMax?: number;
  unit: string | null;
  name: string;
  note: string | null;
  /** Second measure of a dual unit line ("1 cup (200 g)"). */
  altQty?: number;
  altUnit?: string;
  raw_text: string;
  /** True when the line could not be understood; `name` then holds the trimmed raw line. */
  unparsed?: true;
};

type UnitInfo = { canonical: string; system: UnitSystem };

const UNIT_DEFS: Array<[UnitInfo, string[]]> = [
  [{ canonical: 'g', system: 'metric' }, ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes']],
  [{ canonical: 'kg', system: 'metric' }, ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos']],
  [
    { canonical: 'mL', system: 'metric' },
    ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  ],
  [{ canonical: 'L', system: 'metric' }, ['l', 'liter', 'liters', 'litre', 'litres']],
  [{ canonical: 'oz', system: 'us' }, ['oz', 'ounce', 'ounces']],
  [{ canonical: 'lb', system: 'us' }, ['lb', 'lbs', 'pound', 'pounds']],
  [{ canonical: 'cup', system: 'us' }, ['cup', 'cups']],
  [{ canonical: 'tbsp', system: 'us' }, ['tbsp', 'tbsps', 'tbs', 'tablespoon', 'tablespoons']],
  [{ canonical: 'tsp', system: 'us' }, ['tsp', 'tsps', 'teaspoon', 'teaspoons']],
  [{ canonical: 'fl oz', system: 'us' }, ['floz']],
  [{ canonical: 'pt', system: 'us' }, ['pt', 'pint', 'pints']],
  [{ canonical: 'qt', system: 'us' }, ['qt', 'quart', 'quarts']],
  [{ canonical: 'gal', system: 'us' }, ['gal', 'gallon', 'gallons']],
];

const UNITS = new Map<string, UnitInfo>();
for (const [info, names] of UNIT_DEFS) for (const n of names) UNITS.set(n, info);

/** Count-like units kept as written (not a measurement system). */
const CONTAINERS = new Set([
  'can',
  'cans',
  'jar',
  'jars',
  'package',
  'packages',
  'pkg',
  'stick',
  'sticks',
  'clove',
  'cloves',
  'slice',
  'slices',
  'bunch',
  'bunches',
  'sprig',
  'sprigs',
  'shot',
  'shots',
  'head',
  'heads',
]);
/** Vague amounts: "a pinch of salt" reads as one pinch. */
const VAGUE = new Set(['pinch', 'pinches', 'dash', 'dashes', 'handful', 'handfuls', 'splash']);

export function unitSystem(unit: string | null): UnitSystem | null {
  return unit ? (UNITS.get(unit.toLowerCase().replace(/\./g, ''))?.system ?? null) : null;
}

const FRACTIONS: Record<string, number> = {
  '¼': 1 / 4,
  '½': 1 / 2,
  '¾': 3 / 4,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};
const VF = Object.keys(FRACTIONS).join('');
const NUM_SRC = `\\d+\\s+\\d+\\/\\d+|\\d+\\s*[${VF}]|[${VF}]|\\d+\\/\\d+|\\d*\\.\\d+|\\d+`;
const NUM_AT_START = new RegExp(`^(?:${NUM_SRC})`);
const RANGE_SEP = /^\s*(?:-|–|—|to)\s*/i;

function numValue(s: string): number {
  s = s.trim();
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = new RegExp(`^(\\d+)\\s*([${VF}])$`).exec(s);
  if (m) return Number(m[1]) + FRACTIONS[m[2]!]!;
  if (s.length === 1 && FRACTIONS[s] !== undefined) return FRACTIONS[s]!;
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[2]) === 0 ? NaN : Number(m[1]) / Number(m[2]);
  return Number(s);
}

/** Read a number (or a range) at the start of `s`. */
function readQty(s: string): { qty: number; qtyMax?: number; rest: string } | null {
  const a = NUM_AT_START.exec(s);
  if (!a) return null;
  const qty = numValue(a[0]);
  if (!Number.isFinite(qty)) return null;
  const rest = s.slice(a[0].length);
  const sep = RANGE_SEP.exec(rest);
  if (sep) {
    const after = rest.slice(sep[0].length);
    // "to" needs surrounding space so "2 tomatoes" is never read as a range.
    const okSep = sep[0].trim().toLowerCase() !== 'to' || /^\s/.test(rest);
    const b = okSep ? NUM_AT_START.exec(after) : null;
    if (b) {
      const max = numValue(b[0]);
      if (Number.isFinite(max)) {
        return { qty, qtyMax: max, rest: after.slice(b[0].length).trimStart() };
      }
    }
  }
  return { qty, rest: rest.trimStart() };
}

/** Read a unit word (or "fl oz" / "fluid ounce") at the start of `s`. */
function readUnit(s: string): { unit: string; known: boolean; rest: string } | null {
  const fl = /^(?:fl\.?\s*oz\.?|fluid\s+ounces?)(?![a-z])/i.exec(s);
  if (fl) return { unit: 'fl oz', known: true, rest: s.slice(fl[0].length).trimStart() };
  const m = /^([A-Za-z]+)\.?(?![A-Za-z])/.exec(s);
  if (!m) return null;
  const word = m[1]!.toLowerCase();
  const info = UNITS.get(word);
  const rest = s.slice(m[0].length).trimStart();
  if (info) return { unit: info.canonical, known: true, rest };
  if (CONTAINERS.has(word) || VAGUE.has(word)) return { unit: word, known: false, rest };
  return null;
}

/** Parse "200 g" or "1 cup" inside parentheses; null if it is anything else. */
function parseMeasure(inner: string): { qty: number; unit: string } | null {
  const q = readQty(inner.trim());
  if (!q || q.qtyMax !== undefined) return null;
  const u = readUnit(q.rest);
  if (!u || !u.known || u.rest !== '') return null;
  return { qty: q.qty, unit: u.unit };
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+|[\s,;:]+$/g, '');
const NOTE_SUFFIX =
  /\b(to taste|as needed|for (?:serving|garnish|dusting|greasing|frying)|optional)\s*$/i;

/** Split text on the first top-level comma. */
function splitComma(s: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return [s, ''];
}

function unparsed(raw: string): ParsedIngredient {
  return { qty: null, unit: null, name: raw.trim(), note: null, raw_text: raw, unparsed: true };
}

export function parseIngredientLine(raw: string): ParsedIngredient {
  try {
    return parse(raw);
  } catch {
    return unparsed(raw);
  }
}

function parse(raw: string): ParsedIngredient {
  let s = raw
    .replace(/^\s*(?:[-*•▪◦]|\d+[.)](?=\s))\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Empty, no letters at all, or a "For the sauce:" style header.
  if (s === '' || !/\p{L}/u.test(s) || /:$/.test(s)) return unparsed(raw);

  const notes: string[] = [];
  let qty: number | null = null;
  let qtyMax: number | undefined;
  let unit: string | null = null;
  let knownUnit = false;
  let altQty: number | undefined;
  let altUnit: string | undefined;

  const q = readQty(s);
  if (q) {
    qty = q.qty;
    qtyMax = q.qtyMax;
    s = q.rest;
  } else {
    // "a pinch of salt", "an ounce of ..."
    const art = /^(?:an?)\s+(.*)$/i.exec(s);
    if (art) {
      const u = readUnit(art[1]!);
      if (u && (u.known || VAGUE.has(u.unit) || CONTAINERS.has(u.unit))) {
        qty = 1;
        s = art[1]!;
      }
    }
  }

  if (qty !== null) {
    // "1 (14 oz) can tomatoes": the parenthetical describes the container.
    const lead = /^\(([^()]*)\)\s*(.*)$/.exec(s);
    if (lead) {
      notes.push(clean(lead[1]!));
      s = lead[2]!;
    }
    const u = readUnit(s);
    if (u) {
      unit = u.unit;
      knownUnit = u.known;
      s = u.rest.replace(/^of\s+/i, '');
      // Dual unit directly after the measure: "1 cup (200 g) flour" / "200 g (1 cup) flour".
      const dual = /^\(([^()]*)\)\s*(.*)$/.exec(s);
      if (dual && knownUnit) {
        const alt = parseMeasure(dual[1]!);
        if (alt && unitSystem(alt.unit) !== unitSystem(unit)) {
          altQty = alt.qty;
          altUnit = alt.unit;
          s = dual[2]!;
        }
      }
    }
  }

  // Trailing/inner parentheticals: a late dual unit ("flour (120 g)") or a note.
  s = s.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
    const alt = knownUnit && altUnit === undefined ? parseMeasure(inner) : null;
    if (alt && unitSystem(alt.unit) !== unitSystem(unit)) {
      altQty = alt.qty;
      altUnit = alt.unit;
    } else if (clean(inner)) {
      notes.push(clean(inner));
    }
    return ' ';
  });

  const [namePart, comma] = splitComma(s);
  let name = clean(namePart);
  const suffix = NOTE_SUFFIX.exec(name);
  if (suffix) {
    notes.push(suffix[1]!.toLowerCase());
    name = clean(name.slice(0, suffix.index));
  }
  if (clean(comma)) notes.push(clean(comma));

  if (name === '') return unparsed(raw);
  if (/^\p{P}+$/u.test(name)) return unparsed(raw);

  const out: ParsedIngredient = {
    qty,
    unit,
    name,
    note: notes.length ? notes.join(', ') : null,
    raw_text: raw,
  };
  if (qtyMax !== undefined) out.qtyMax = qtyMax;
  if (altQty !== undefined && altUnit !== undefined) {
    out.altQty = altQty;
    out.altUnit = altUnit;
  }
  return out;
}

export type IngredientFields = {
  name: string;
  note: string | null;
  raw_text: string;
  metric_qty: number | null;
  metric_qty_max: number | null;
  metric_unit: string | null;
  us_qty: number | null;
  us_qty_max: number | null;
  us_unit: string | null;
  display_primary: UnitSystem;
};

/**
 * Map a parsed line to the stored columns. Known metric units fill `metric_*`, known US
 * units fill `us_*`, dual units fill both (display_primary = first written). Counts and
 * other units (can, clove, pinch) go to `metric_qty` with the unit text as written
 * (null for plain counts). Nothing is converted: a missing side stays null. A range ("2-3") fills `*_qty_max`
 * on the primary side only.
 */
export function toIngredientFields(p: ParsedIngredient): IngredientFields {
  const f: IngredientFields = {
    name: p.name,
    note: p.note,
    raw_text: p.raw_text,
    metric_qty: null,
    metric_qty_max: null,
    metric_unit: null,
    us_qty: null,
    us_qty_max: null,
    us_unit: null,
    display_primary: 'metric',
  };
  if (p.unparsed || p.qty === null) return f;
  const sys = unitSystem(p.unit);
  const put = (system: UnitSystem, qty: number, unit: string | null, qtyMax: number | null) => {
    if (system === 'us') {
      f.us_qty = qty;
      f.us_qty_max = qtyMax;
      f.us_unit = unit;
    } else {
      f.metric_qty = qty;
      f.metric_qty_max = qtyMax;
      f.metric_unit = unit;
    }
  };
  // A range only counts when the upper bound is above the lower one.
  const max = p.qtyMax !== undefined && p.qtyMax > p.qty ? p.qtyMax : null;
  if (sys === null) {
    put('metric', p.qty, p.unit, max);
    return f;
  }
  f.display_primary = sys;
  put(sys, p.qty, p.unit, max);
  if (p.altQty !== undefined && p.altUnit) {
    const altSys = unitSystem(p.altUnit);
    if (altSys && altSys !== sys) put(altSys, p.altQty, p.altUnit, null);
  }
  return f;
}
