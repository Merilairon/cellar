// Verb list, step classification, temperature and duration extraction (tasklist G2, G5,
// G17, G18). Lexical only: sets of lowercase words and single-pass scanners. English only;
// other languages fall back to 3a labels and low confidence (known limitation).

import { pattern } from './map-patterns';
import { safeSlice, tokenizeDetailed, type Token } from './text-tokens';

export type VerbClass = 'combine' | 'cook' | 'prep' | 'finish';

const COMBINE = [
  'mix', 'stir', 'whisk', 'beat', 'fold', 'blend', 'cream', 'knead', 'combine', 'add', 'sift',
  'toss', 'season', 'marinate', 'pour', 'mash', 'puree', 'purée', 'crush', 'coat', 'dip',
  'roll', 'shape', 'form', 'layer', 'assemble', 'spoon', 'sprinkle', 'dissolve', 'dredge',
  'stuff', 'whip', 'mince', 'chop', 'dice', 'peel', 'drain', 'grate', 'zest', 'squeeze',
  'press', 'knead', 'incorporate', 'sprinkle', 'divide',
]; // prettier-ignore
const COOK = [
  'melt', 'simmer', 'boil', 'bake', 'roast', 'fry', 'saute', 'sauté', 'sear', 'grill', 'steam',
  'poach', 'broil', 'toast', 'reduce', 'cook', 'caramelize', 'heat', 'bring', 'braise', 'stew',
  'blanch', 'scald', 'brown',
]; // prettier-ignore
const FINISH = [
  'cool', 'chill', 'refrigerate', 'rest', 'let', 'allow', 'stand', 'serve', 'garnish', 'top',
  'drizzle', 'spread', 'frost', 'decorate', 'dust', 'store', 'slice', 'cut', 'enjoy', 'freeze',
  'place', 'put', 'transfer', 'arrange', 'glaze', 'ice', 'plate',
]; // prettier-ignore
const PREP = ['preheat'];

/** "brown" is a cook verb only when it is not the colour of a known ingredient. */
const BROWN_NOUN_NEXT = new Set(['sugar', 'rice', 'butter', 'mustard', 'bread', 'flour', 'onion']);
const CREAM_NOUN_PREV = new Set([
  'heavy',
  'sour',
  'whipping',
  'whipped',
  'double',
  'single',
  'ice',
  'coconut',
]);

export const VERB_CLASS: ReadonlyMap<string, VerbClass> = (() => {
  const m = new Map<string, VerbClass>();
  for (const w of COMBINE) m.set(w, 'combine');
  for (const w of COOK) m.set(w, 'cook');
  for (const w of FINISH) m.set(w, 'finish');
  for (const w of PREP) m.set(w, 'prep');
  return m;
})();

/** The controlled verb list (lowercase words). */
export const VERBS: ReadonlySet<string> = new Set(VERB_CLASS.keys());

export const PHRASAL_VERBS: ReadonlySet<string> = new Set([
  'fold in', 'beat in', 'stir in', 'mix in', 'whisk in', 'add in', 'cut in', 'blend in', 'pour over',
]); // prettier-ignore

/** Verbs that mark a prep step when followed by a pan, oven or similar object (G2). */
const PREP_OBJECTS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const pans = [
    'pan', 'tin', 'dish', 'skillet', 'sheet', 'tray', 'oven', 'rack', 'mould', 'mold', 'pot',
    'griddle', 'grill', 'ramekin', 'ramekins', 'molds', 'moulds', 'pans', 'tins', 'dishes',
    'trays', 'sheets', 'racks',
  ]; // prettier-ignore
  const m = new Map<string, ReadonlySet<string>>();
  for (const v of [
    'grease',
    'butter',
    'flour',
    'line',
    'prepare',
    'oil',
    'rinse',
    'dust',
    'spray',
    'coat',
  ])
    m.set(v, new Set(pans));
  m.set('heat', new Set(['oven', 'grill']));
  m.set('set', new Set(['aside', 'oven', 'rack']));
  m.set('bring', new Set(['room']));
  return m;
})();
const PREP_ALWAYS = new Set(['preheat', 'gather']);
const PREP_WINDOW = 8;

const SUBORDINATORS = new Set(['once', 'when', 'after', 'while', 'until', 'if', 'as', 'before']);

/** Finish verbs that mark a pure serving note, even when it names a new ingredient (G19). */
export const SERVE_VERBS: ReadonlySet<string> = new Set([
  'serve',
  'garnish',
  'enjoy',
  'store',
  'plate',
]);

export type GroupRef = 'all' | 'dry' | 'wet';

export type StepClass = {
  /** Controlled-list verb (phrasal included), lowercase, or null. */
  verb: string | null;
  /** Grid label: the verb, or the first words of the step (max 24 chars). */
  label: string;
  /** Class of the first verb. */
  class: VerbClass | null;
  isPrep: boolean;
  hasCook: boolean;
  hasCombine: boolean;
  /** Leading verb is a finish verb. */
  leadFinish: boolean;
  /** Leading verb is a pure serving verb. */
  leadServe: boolean;
  hasGroupRef: GroupRef | null;
  temp: { c?: number; f?: number };
  minutes: { min?: number; max?: number };
  warnings: Array<'time_ambiguous'>;
};

// -- label fallback ---------------------------------------------------------------------

const LETTER_OR_DIGIT = pattern('label-letter-or-digit', /^[\p{L}\p{N}]$/u);

/** First three words of the text, trimmed to 24 chars; same intent as the 3a stepLabel. */
export function fallbackLabel(text: string): string {
  const s = String(text).slice(0, 200);
  let i = 0;
  while (i < s.length && !LETTER_OR_DIGIT.test(s[i]!)) i++;
  const words: string[] = [];
  while (i < s.length && words.length < 3) {
    let j = i;
    while (j < s.length && s[j] !== ' ' && s[j] !== '\n' && s[j] !== '\t') j++;
    words.push(s.slice(i, j));
    i = j;
    while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t')) i++;
  }
  let label = words.join(' ');
  while (label.length > 0 && '.,;:!?'.includes(label[label.length - 1]!))
    label = label.slice(0, -1);
  if (label.length > 24) label = safeSlice(label, 24).trim();
  return label || 'step';
}

// -- verb picking -----------------------------------------------------------------------

function sentenceStarts(tokens: Token[]): number[] {
  const starts: number[] = [];
  let last = -1;
  tokens.forEach((t, i) => {
    if (t.sent !== last) {
      starts.push(i);
      last = t.sent;
    }
  });
  return starts;
}

function isLy(w: string): boolean {
  return (w.length > 3 && w.endsWith('ly')) || w === 'well';
}

/** Verb class of the token at `i`, with the noun guards for "brown" and "cream". */
function classAt(tokens: Token[], i: number): VerbClass | undefined {
  const w = tokens[i]!.w;
  const cls = VERB_CLASS.get(w);
  if (!cls) return undefined;
  if (w === 'brown' && BROWN_NOUN_NEXT.has(tokens[i + 1]?.w ?? '')) return undefined;
  if (w === 'cream' && CREAM_NOUN_PREV.has(tokens[i - 1]?.w ?? '')) return undefined;
  return cls;
}

const LEAD_SKIP = new Set(['then', 'next', 'first', 'now', 'also', 'finally']);
const NOT_AN_OBJECT = new Set(['is', 'are', 'was', 'were', 'and', 'or']);

/**
 * Token indexes that are the imperative verb of a sentence: the first content token (after
 * "-ly" adverbs and "then"/"next"), a listed verb, followed by more words in the same clause.
 * "Cream the butter" starts with the verb "cream", not with the ingredient "cream"; a
 * mention there is the action, so ingredient matching ignores it (review M1). A comma or
 * end of sentence after the token keeps the noun reading ("Cream, sugar and eggs ...").
 */
export function imperativeLeadIndexes(tokens: Token[]): Set<number> {
  const out = new Set<number>();
  let last = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.sent === last) continue;
    last = t.sent;
    let j = i;
    while (
      j < tokens.length &&
      tokens[j]!.sent === t.sent &&
      (isLy(tokens[j]!.w) || LEAD_SKIP.has(tokens[j]!.w))
    )
      j++;
    const lead = tokens[j];
    if (!lead || lead.sent !== t.sent || !classAt(tokens, j)) continue;
    const next = tokens[j + 1];
    if (!next || next.sent !== lead.sent || next.clause !== lead.clause) continue;
    if (NOT_AN_OBJECT.has(next.w)) continue;
    out.add(j);
  }
  return out;
}

/** The leading prep verb when the step is a prep step (G2), else null. */
function detectPrep(tokens: Token[]): string | null {
  let i = 0;
  while (i < tokens.length && tokens[i]!.sent === 0 && isLy(tokens[i]!.w)) i++;
  let first = tokens[i];
  if (!first || first.sent !== 0) return null;
  // "Then grease ..." / "Next, preheat ..."
  if ((first.w === 'then' || first.w === 'next' || first.w === 'first') && tokens[i + 1]) {
    i++;
    first = tokens[i]!;
  }
  if (PREP_ALWAYS.has(first.w)) return first.w;
  const objects = PREP_OBJECTS.get(first.w);
  if (!objects) return null;
  for (let j = i + 1; j < tokens.length && j <= i + PREP_WINDOW; j++) {
    const t = tokens[j]!;
    if (t.sent !== 0) break;
    if (objects.has(t.w)) return first.w;
    // "Butter the bread and place on a baking sheet": another verb ends the prep clause.
    if (VERB_CLASS.has(t.w)) break;
  }
  return null;
}

function findVerb(tokens: Token[]): { verb: string; cls: VerbClass; at: number } | null {
  const starts = sentenceStarts(tokens);
  for (let si = 0; si < starts.length; si++) {
    const from = starts[si]!;
    const to = si + 1 < starts.length ? starts[si + 1]! : tokens.length;
    let i = from;
    const head = tokens[from]!;
    if (SUBORDINATORS.has(head.w)) {
      let j = from + 1;
      while (j < to && tokens[j]!.clause === head.clause) j++;
      i = j < to ? j : from + 1;
    }
    for (; i < to; i++) {
      const w = tokens[i]!.w;
      let cls = classAt(tokens, i);
      if (!cls) continue;
      const next = tokens[i + 1]?.w;
      if (next !== undefined && i + 1 < to && PHRASAL_VERBS.has(`${w} ${next}`)) {
        return { verb: `${w} ${next}`, cls: 'combine', at: i };
      }
      if (w === 'let' || w === 'allow') {
        for (let k = i + 1; k < Math.min(to, i + 4); k++) {
          const c = classAt(tokens, k);
          if (c) return { verb: tokens[k]!.w, cls: 'finish', at: i };
        }
        cls = 'finish';
      }
      return { verb: w, cls, at: i };
    }
  }
  return null;
}

function detectGroupRef(tokens: Token[]): GroupRef | null {
  const ws = tokens.map((t) => t.w);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const n1 = ws[i + 1] ?? '';
    const n2 = ws[i + 2] ?? '';
    const n3 = ws[i + 3] ?? '';
    if (w === 'everything') return 'all';
    if (w === 'all' && n1.startsWith('ingredient')) return 'all';
    if (w === 'all' && n1 === 'the' && n2.startsWith('ingredient')) return 'all';
    if (w === 'all' && n1 === 'of' && n2 === 'the' && n3.startsWith('ingredient')) return 'all';
    if (w === 'remaining' && n1.startsWith('ingredient')) return 'all';
    if (w === 'the' && n1 === 'rest' && n2 !== 'of') return 'all';
    if (w === 'dry' && n1.startsWith('ingredient')) return 'dry';
    if (w === 'wet' && n1.startsWith('ingredient')) return 'wet';
  }
  return null;
}

// -- temperature (G17) --------------------------------------------------------------------

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isDegree = (ch: string): boolean => ch === '°' || ch === 'º' || ch === '˚';

function readWord(s: string, i: number): { w: string; end: number } {
  let j = i;
  while (j < s.length && isAlpha(s.charCodeAt(j))) j++;
  return { w: s.slice(i, j), end: j };
}

export function extractTemperature(text: string): { c?: number; f?: number } {
  const s = String(text).slice(0, 4000);
  const out: { c?: number; f?: number } = {};
  let i = 0;
  while (i < s.length) {
    if (!isDigit(s.charCodeAt(i))) {
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && j - i < 5 && isDigit(s.charCodeAt(j))) j++;
    const startsInWord = i > 0 && (isAlpha(s.charCodeAt(i - 1)) || isDigit(s.charCodeAt(i - 1)));
    const decimalTail = s[j] === '.' && isDigit(s.charCodeAt(j + 1));
    const value = Number(s.slice(i, j));
    let k = j;
    while (k < s.length && k - j < 2 && s[k] === ' ') k++;
    let deg = false;
    if (k < s.length && isDegree(s[k]!)) {
      deg = true;
      k++;
    }
    while (k < s.length && k - j < 4 && s[k] === ' ') k++;
    const { w, end } = readWord(s, k);
    i = Math.max(j, i + 1);
    if (startsInWord || decimalTail || w === '') continue;
    let unit: 'c' | 'f' | null = null;
    let word = w;
    let after = end;
    if (word.toLowerCase() === 'degrees' || word.toLowerCase() === 'degree') {
      deg = true;
      let m = after;
      while (m < s.length && s[m] === ' ') m++;
      const nx = readWord(s, m);
      word = nx.w;
      after = nx.end;
    }
    const lw = word.toLowerCase();
    if (lw === 'fahrenheit') unit = 'f';
    else if (lw === 'celsius' || lw === 'centigrade') unit = 'c';
    else if (word.length === 1 && (lw === 'f' || lw === 'c')) {
      if (
        lw === 'f' &&
        ((deg && value >= 100 && value <= 900) || (word === 'F' && value >= 150 && value <= 900))
      )
        unit = 'f';
      if (
        lw === 'c' &&
        ((deg && value >= 50 && value <= 500) || (word === 'C' && value >= 100 && value <= 300))
      )
        unit = 'c';
    }
    if (unit === 'f' && out.f === undefined && value <= 2000) out.f = value;
    if (unit === 'c' && out.c === undefined && value <= 1000) out.c = value;
    i = Math.max(i, after);
  }
  return out;
}

// -- duration (G17) -----------------------------------------------------------------------

function unitMinutes(w: string): number | null {
  switch (w) {
    case 'minute': case 'minutes': case 'min': case 'mins': return 1;
    case 'hour': case 'hours': case 'hr': case 'hrs': case 'h': return 60;
    default: return null;
  }
} // prettier-ignore

function readNumber(s: string, i: number): { v: number; end: number } | null {
  if (!isDigit(s.charCodeAt(i))) return null;
  let j = i;
  while (j < s.length && j - i < 6 && isDigit(s.charCodeAt(j))) j++;
  if (s[j] === '.' && isDigit(s.charCodeAt(j + 1))) {
    j++;
    const f = j;
    while (j < s.length && j - f < 3 && isDigit(s.charCodeAt(j))) j++;
  }
  return { v: Number(s.slice(i, j)), end: j };
}

const skipSpaces = (s: string, i: number): number => {
  let j = i;
  while (j < s.length && j - i < 4 && s[j] === ' ') j++;
  return j;
};

type Duration = { min: number; max: number };

export function extractDurations(text: string): Duration[] {
  const s = String(text).slice(0, 4000);
  const found: Duration[] = [];
  let i = 0;
  while (i < s.length && found.length < 8) {
    const prev = i > 0 ? s.charCodeAt(i - 1) : 32;
    const fractionOrDecimal = prev === 47 || prev === 46; // "1/2 hour" is not 2 hours
    const n1 =
      isDigit(s.charCodeAt(i)) && !isAlpha(prev) && !isDigit(prev) && !fractionOrDecimal
        ? readNumber(s, i)
        : null;
    if (!n1) {
      i++;
      continue;
    }
    let k = skipSpaces(s, n1.end);
    let hi = n1.v;
    if (s[k] === '-' || s[k] === '–' || s[k] === '—') {
      const n2 = readNumber(s, skipSpaces(s, k + 1));
      if (n2) {
        hi = n2.v;
        k = skipSpaces(s, n2.end);
      }
    } else if (s.startsWith('to ', k)) {
      const n2 = readNumber(s, skipSpaces(s, k + 3));
      if (n2) {
        hi = n2.v;
        k = skipSpaces(s, n2.end);
      }
    }
    const { w, end } = readWord(s, k);
    const mult = unitMinutes(w.toLowerCase());
    if (mult === null) {
      i = n1.end;
      continue;
    }
    let lo = n1.v * mult;
    let up = hi * mult;
    let next = end;
    if (mult === 60 && hi === n1.v) {
      // "1 hour 15 minutes" / "1 hour and 15 minutes"
      let m = skipSpaces(s, end);
      if (s.startsWith('and ', m)) m = skipSpaces(s, m + 4);
      const n3 = readNumber(s, m);
      if (n3) {
        const u = readWord(s, skipSpaces(s, n3.end));
        if (unitMinutes(u.w.toLowerCase()) === 1) {
          lo += n3.v;
          up += n3.v;
          next = u.end;
        }
      }
    }
    found.push({ min: Math.round(lo), max: Math.round(up) });
    i = Math.max(next, i + 1);
  }
  return found;
}

// -- main entry -------------------------------------------------------------------------

export function classifyTokens(text: string, tokens: Token[]): StepClass {
  const prepVerb = detectPrep(tokens);
  const isPrep = prepVerb !== null;
  const found = findVerb(tokens);
  let hasCook = false;
  let hasCombine = false;
  for (let i = 0; i < tokens.length; i++) {
    const c = classAt(tokens, i);
    if (c === 'cook') hasCook = true;
    else if (c === 'combine') hasCombine = true;
  }
  const durations = extractDurations(text);
  const warnings: Array<'time_ambiguous'> = [];
  const distinct = new Set(durations.map((d) => `${d.min}-${d.max}`));
  if (distinct.size > 1) warnings.push('time_ambiguous');
  const d = durations[0];
  let verb = found ? found.verb : null;
  if (prepVerb && (!verb || verb !== prepVerb)) verb = prepVerb;
  const label = verb ? safeSlice(verb, 24).trim() : fallbackLabel(text);
  return {
    verb,
    label: label || 'step',
    class: isPrep ? 'prep' : (found?.cls ?? null),
    isPrep,
    hasCook,
    hasCombine,
    leadFinish: !isPrep && found?.cls === 'finish',
    leadServe: !isPrep && found !== null && SERVE_VERBS.has(found.verb),
    hasGroupRef: detectGroupRef(tokens),
    temp: extractTemperature(text),
    minutes: d ? { min: d.min, max: d.max } : {},
    warnings,
  };
}

export function classifyStep(text: string): StepClass {
  return classifyTokens(text, tokenizeDetailed(text, 800).tokens);
}
