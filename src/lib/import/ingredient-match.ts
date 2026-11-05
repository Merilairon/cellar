// Ingredient-name matching (tasklist G6, G7). Names are compared as token sequences held
// in Maps and Sets; no regex is ever built from a name. Every candidate check is counted
// against a deterministic operation budget.

import { singularize, tokenizeDetailed } from './text-tokens';

// -- budget -----------------------------------------------------------------------------

export type Budget = { used: number; limit: number };

export class BudgetExceeded extends Error {
  constructor() {
    super('mapper operation budget exceeded');
    this.name = 'BudgetExceeded';
  }
}

export function spend(b: Budget, n = 1): void {
  b.used += n;
  if (b.used > b.limit) throw new BudgetExceeded();
}

// -- tables -----------------------------------------------------------------------------

/** Size/state words dropped for the modifier-less match levels (G6). */
export const MODIFIERS: ReadonlySet<string> = new Set([
  'large',
  'medium',
  'small',
  'big',
  'fresh',
  'ripe',
  'freshly',
  'ground',
  'chopped',
  'finely',
  'roughly',
  'coarsely',
  'minced',
  'diced',
  'sliced',
  'grated',
  'shredded',
  'unsalted',
  'salted',
  'softened',
  'melted',
  'cold',
  'warm',
  'room',
  'temperature',
  'packed',
  'dark',
  'light',
  'extra',
  'virgin',
  'good',
  'quality',
  'whole',
  'organic',
  'plain',
  'toasted',
  'dried',
  'frozen',
  'canned',
  'boneless',
  'skinless',
]);

/**
 * Small, safe, symmetric synonym groups. Each phrase is run through the same pipeline as
 * names, so plural and apostrophe variants collapse. `coriander` is deliberately absent
 * (leaf vs seed). `cornstarch = cornflour` follows the UK reading; in the US `cornflour`
 * can mean a finer corn flour, which is a known limitation.
 */
export const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ['scallion', 'green onion', 'spring onion'],
  ['confectioners sugar', 'powdered sugar', 'icing sugar'],
  ['caster sugar', 'superfine sugar'],
  ['baking soda', 'bicarbonate of soda'],
  ['plain flour', 'all purpose flour'],
  ['eggplant', 'aubergine'],
  ['zucchini', 'courgette'],
  ['heavy cream', 'double cream', 'heavy whipping cream'],
  ['bell pepper', 'capsicum'],
  ['vanilla', 'vanilla extract'],
  ['cocoa', 'cocoa powder'],
  ['chili', 'chilli'],
  ['garbanzo bean', 'chickpea'],
  ['cornstarch', 'cornflour'],
];

// -- name normalization -----------------------------------------------------------------

/** Singularized tokens of the main clause of a name (parentheticals and after-comma text removed). */
export function nameTokens(name: string): string[] {
  const { tokens } = tokenizeDetailed(name, 60);
  const out: string[] = [];
  for (const t of tokens) {
    if (t.clause > 0 || t.sent > 0) break;
    out.push(singularize(t.w));
  }
  return out;
}

function dropModifiers(tokens: string[]): string[] {
  const kept = tokens.filter((t) => !MODIFIERS.has(t));
  return kept.length > 0 ? kept : tokens;
}

/** Canonical comparison key for a row: modifiers dropped, singular, space separated. */
export function rowKey(name: string): string {
  return dropModifiers(nameTokens(name)).join(' ');
}

const SYNONYM_OF: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  SYNONYM_GROUPS.forEach((g, gi) => {
    for (const p of g) m.set(nameTokens(p).join(' '), gi);
  });
  return m;
})();

/** Group index of a synonym phrase, or -1. Exposed for collision tests. */
export function synonymGroupOf(phrase: string): number {
  return SYNONYM_OF.get(nameTokens(phrase).join(' ')) ?? -1;
}

// -- index ------------------------------------------------------------------------------

type Variant = {
  seq: string[];
  /** Candidate ingredient ids per match level 1..4 (index 0..3). */
  byLevel: [Set<number>, Set<number>, Set<number>, Set<number>];
  /** Lazy sorted copies of `byLevel`. */
  sorted?: [number[] | null, number[] | null, number[] | null, number[] | null];
};

export type NameIndex = {
  byFirst: Map<string, Variant[]>;
  /** Full normalized name per ingredient id; equal keys are the "same ingredient" case. */
  keys: string[];
};

export type Mention = {
  /** Candidate ingredient ids at the best matching level. */
  ids: number[];
  level: 1 | 2 | 3 | 4;
  /** Index of the first matched token and number of tokens consumed. */
  at: number;
  len: number;
  /** True when several different ingredients share the match (G7). */
  ambiguous: boolean;
};

export function buildIndex(names: string[], budget?: Budget): NameIndex {
  const variants = new Map<string, Variant>();
  const keys: string[] = [];
  const add = (seq: string[], level: 1 | 2 | 3 | 4, id: number) => {
    if (seq.length === 0) return;
    const k = seq.join(' ');
    let v = variants.get(k);
    if (!v) {
      v = { seq, byLevel: [new Set(), new Set(), new Set(), new Set()] };
      variants.set(k, v);
    }
    v.byLevel[level - 1].add(id);
  };
  names.forEach((name, id) => {
    if (budget) spend(budget, 4);
    const full = nameTokens(name);
    keys.push(full.join(' '));
    const dropped = dropModifiers(full);
    add(full, 1, id);
    if (dropped.length !== full.length) add(dropped, 3, id);
    for (const form of [full, dropped]) {
      const g = SYNONYM_OF.get(form.join(' '));
      if (g !== undefined) {
        for (const p of SYNONYM_GROUPS[g]!) add(nameTokens(p), 2, id);
      }
    }
    if (dropped.length > 1) add([dropped[dropped.length - 1]!], 4, id);
  });
  const byFirst = new Map<string, Variant[]>();
  for (const v of variants.values()) {
    const first = v.seq[0]!;
    const list = byFirst.get(first);
    if (list) list.push(v);
    else byFirst.set(first, [v]);
  }
  return { byFirst, keys };
}

/** Sorted candidate ids of a variant at a level, computed once per variant and level. */
function sortedIds(v: Variant, level: 1 | 2 | 3 | 4): number[] {
  v.sorted ??= [null, null, null, null];
  return (v.sorted[level - 1] ??= [...v.byLevel[level - 1]!].sort((a, b) => a - b));
}

function bestLevel(v: Variant): 1 | 2 | 3 | 4 {
  for (let l = 0; l < 4; l++) if (v.byLevel[l]!.size > 0) return (l + 1) as 1 | 2 | 3 | 4;
  return 4;
}

/**
 * Find ingredient mentions in singularized step words. Greedy, longest match first, then
 * lowest level; matched words are consumed so "brown sugar" never also matches "sugar".
 */
export function findMentions(words: string[], index: NameIndex, budget: Budget): Mention[] {
  const out: Mention[] = [];
  let i = 0;
  while (i < words.length) {
    spend(budget);
    const cands = index.byFirst.get(words[i]!);
    let best: { v: Variant; level: 1 | 2 | 3 | 4 } | null = null;
    if (cands) {
      for (const v of cands) {
        spend(budget);
        const n = v.seq.length;
        if (i + n > words.length) continue;
        let ok = true;
        for (let j = 1; j < n; j++) {
          spend(budget);
          if (words[i + j] !== v.seq[j]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const level = bestLevel(v);
        if (!best || n > best.v.seq.length || (n === best.v.seq.length && level < best.level)) {
          best = { v, level };
        }
      }
    }
    if (!best) {
      i++;
      continue;
    }
    const set = best.v.byLevel[best.level - 1]!;
    // The sort and the every() below cost O(k) and O(k log k): charge them (security F1).
    spend(budget, set.size);
    const ids = sortedIds(best.v, best.level);
    const sameKey = ids.every((id) => index.keys[id] === index.keys[ids[0]!]);
    out.push({
      ids: [...ids],
      level: best.level,
      at: i,
      len: best.v.seq.length,
      ambiguous: ids.length > 1 && !sameKey,
    });
    i += best.v.seq.length;
  }
  return out;
}
