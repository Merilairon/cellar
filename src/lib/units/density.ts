// Small density table (grams per mL) with a conservative name matcher.
// Values are commonly published figures (King Arthur Baking ingredient weight chart,
// USDA FoodData Central, and the US legal cup of 236.5882365 mL); approved as owner decision Q10.
// They are kitchen approximations, not lab values.

import { singularize } from '../import/text-tokens';

export type DensityRow = {
  id: string;
  gPerMl: number;
  /** Which way recipes usually measure it: dry/solid goods by weight, liquids by volume. */
  measuredBy: 'weight' | 'volume';
};

const CUP_ML = 236.5882365;
const perCup = (grams: number): number => grams / CUP_ML;

type Entry = DensityRow & {
  /** Contiguous singular-token phrases; one must END the (leading) ingredient name. */
  phrases: string[][];
  /** Any of these tokens anywhere in the name vetoes the row. */
  exclude: string[];
};

// Order matters: more specific rows first (brown sugar before sugar).
const TABLE: readonly Entry[] = [
  {
    id: 'brown sugar',
    gPerMl: perCup(213),
    measuredBy: 'weight',
    phrases: [
      ['brown', 'sugar'],
      ['muscovado', 'sugar'],
    ],
    exclude: ['coconut'],
  }, // 213 g/cup packed
  {
    id: 'powdered sugar',
    gPerMl: perCup(120),
    measuredBy: 'weight',
    phrases: [
      ['powdered', 'sugar'],
      ['confectioner', 'sugar'],
      ['icing', 'sugar'],
    ],
    exclude: [],
  }, // 120 g/cup
  {
    id: 'granulated sugar',
    gPerMl: perCup(200),
    measuredBy: 'weight',
    phrases: [
      ['granulated', 'sugar'],
      ['caster', 'sugar'],
      ['superfine', 'sugar'],
      ['white', 'sugar'],
      ['sugar'],
    ],
    exclude: ['coconut', 'palm', 'vanilla', 'cinnamon'],
  }, // 200 g/cup
  {
    id: 'flour',
    gPerMl: perCup(125),
    measuredBy: 'weight',
    phrases: [['flour']],
    exclude: [
      'almond',
      'coconut',
      'rice',
      'oat',
      'chickpea',
      'buckwheat',
      'cassava',
      'tapioca',
      'corn',
      'soy',
      'tortilla',
      'tortillas',
    ],
  }, // 125 g/cup all-purpose, spooned and leveled
  {
    id: 'butter',
    gPerMl: perCup(227),
    measuredBy: 'weight',
    phrases: [['butter']],
    exclude: [
      'peanut',
      'almond',
      'nut',
      'apple',
      'cocoa',
      'cacao',
      'shea',
      'cashew',
      'sunflower',
      'seed',
      'bean',
      'cookie',
    ],
  }, // 227 g/cup (2 sticks)
  {
    id: 'cocoa powder',
    gPerMl: perCup(85),
    measuredBy: 'weight',
    phrases: [['cocoa', 'powder'], ['cacao', 'powder'], ['cocoa']],
    exclude: ['hot', 'mix', 'drink', 'butter', 'nib'],
  }, // 85 g/cup unsweetened
  { id: 'honey', gPerMl: 1.42, measuredBy: 'weight', phrases: [['honey']], exclude: [] }, // ~340 g/cup
  {
    id: 'milk',
    gPerMl: 1.03,
    measuredBy: 'volume',
    phrases: [['milk']],
    exclude: [
      'coconut',
      'almond',
      'soy',
      'oat',
      'rice',
      'cashew',
      'condensed',
      'evaporated',
      'powder',
      'dry',
      'chocolate',
      'malted',
      'hemp',
    ],
  }, // whole milk ~1.03 g/mL
  {
    id: 'water',
    gPerMl: 1,
    measuredBy: 'volume',
    phrases: [['water']],
    exclude: ['coconut', 'rose', 'orange', 'flower', 'blossom', 'tonic'],
  }, // 1 g/mL by definition at room temperature
  {
    id: 'oil',
    gPerMl: 0.92,
    measuredBy: 'volume',
    phrases: [['oil']],
    exclude: ['coconut', 'essential', 'mineral', 'fish', 'palm'],
  }, // vegetable/olive ~0.91-0.92 g/mL
];

/** Words that may follow the ingredient noun without changing what it is. */
const TRAILING = new Set([
  'melted',
  'softened',
  'sifted',
  'packed',
  'chilled',
  'cold',
  'warm',
  'divided',
  'room',
  'temperature',
]);

const IS_LETTER = /^\p{L}$/u;

/** Lowercase singular tokens of the name up to the first comma, semicolon or parenthesis. */
export function nameTokens(name: string): string[] {
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur) out.push(singularize(cur));
    cur = '';
  };
  for (const ch of name.toLowerCase()) {
    if (ch === ',' || ch === ';' || ch === '(') break;
    if (ch === "'" || ch === '’') continue;
    if (IS_LETTER.test(ch)) cur += ch;
    else flush();
  }
  flush();
  return out;
}

const endsWithPhrase = (tokens: string[], phrase: string[]): boolean => {
  if (tokens.length < phrase.length) return false;
  const off = tokens.length - phrase.length;
  return phrase.every((p, i) => tokens[off + i] === p);
};

/** Head-noun match with an exclusion list. `null` is the safe answer for anything unsure. */
export function findDensity(ingredientName: string): DensityRow | null {
  let tokens = nameTokens(ingredientName);
  while (tokens.length > 1 && TRAILING.has(tokens[tokens.length - 1]!))
    tokens = tokens.slice(0, -1);
  if (tokens.length === 0) return null;
  for (const e of TABLE) {
    if (e.exclude.some((x) => tokens.includes(x))) continue;
    if (e.phrases.some((p) => endsWithPhrase(tokens, p))) {
      return { id: e.id, gPerMl: e.gPerMl, measuredBy: e.measuredBy };
    }
  }
  return null;
}

export const DENSITY_IDS: readonly string[] = TABLE.map((e) => e.id);
