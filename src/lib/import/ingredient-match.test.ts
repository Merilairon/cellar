import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  BudgetExceeded,
  findMentions,
  MODIFIERS,
  nameTokens,
  rowKey,
  SYNONYM_GROUPS,
  synonymGroupOf,
  type Budget,
} from './ingredient-match';
import { singularize, tokenize } from './text-tokens';

const budget = (): Budget => ({ used: 0, limit: 1_000_000 });
const words = (s: string) => tokenize(s).map(singularize);

function match(names: string[], step: string) {
  const idx = buildIndex(names);
  return findMentions(words(step), idx, budget());
}
const ids = (names: string[], step: string) => match(names, step).map((m) => m.ids);

describe('nameTokens and rowKey', () => {
  const rows: Array<[string, string]> = [
    ['unsalted butter', 'butter'],
    ['large eggs', 'egg'],
    ['dark chocolate chunks', 'chocolate chunk'],
    ['brown sugar', 'brown sugar'],
    ['butter (softened)', 'butter'],
    ['tomatoes, diced', 'tomato'],
    ['Extra Virgin Olive Oil', 'olive oil'],
    ['ground', 'ground'],
  ];
  it.each(rows)('%s -> %s', (name, key) => expect(rowKey(name)).toBe(key));
  it('keeps modifiers in nameTokens', () => {
    expect(nameTokens('large eggs')).toEqual(['large', 'egg']);
  });
});

describe('synonym table', () => {
  it('has no phrase in two groups', () => {
    const seen = new Map<string, number>();
    SYNONYM_GROUPS.forEach((g, gi) => {
      for (const p of g) {
        const k = nameTokens(p).join(' ');
        expect(seen.has(k), `duplicate phrase ${k}`).toBe(false);
        seen.set(k, gi);
      }
    });
  });
  it('does not merge coriander and cilantro', () => {
    expect(synonymGroupOf('coriander')).toBe(-1);
    expect(synonymGroupOf('cilantro')).toBe(-1);
  });
  it('contains no modifier-only phrase', () => {
    for (const g of SYNONYM_GROUPS) for (const p of g) expect(MODIFIERS.has(p)).toBe(false);
  });
  const pairs: Array<[string, string]> = [
    ['scallion', 'green onions'],
    ['scallions', 'spring onion'],
    ['confectioners sugar', 'powdered sugar'],
    ["confectioners' sugar", 'icing sugar'],
    ['baking soda', 'bicarbonate of soda'],
    ['eggplant', 'aubergine'],
    ['zucchini', 'courgettes'],
    ['bell pepper', 'capsicum'],
    ['heavy cream', 'double cream'],
    ['chili', 'chilli'],
    ['garbanzo beans', 'chickpeas'],
  ];
  it.each(pairs)('%s <-> %s both ways', (a, b) => {
    expect(ids([a], `Add the ${b}.`)).toEqual([[0]]);
    expect(ids([b], `Add the ${a}.`)).toEqual([[0]]);
  });
});

describe('match levels', () => {
  it('level 1: full name', () => {
    const m = match(['brown sugar'], 'Stir in the brown sugar.');
    expect(m).toMatchObject([{ ids: [0], level: 1, len: 2 }]);
  });
  it('plural and singular both match', () => {
    expect(ids(['egg'], 'Beat the eggs.')).toEqual([[0]]);
    expect(ids(['eggs'], 'Beat the egg.')).toEqual([[0]]);
    expect(ids(['tomatoes'], 'Chop the tomato.')).toEqual([[0]]);
    expect(ids(['bay leaf'], 'Add the bay leaves.')).toEqual([[0]]);
    expect(ids(['loaf'], 'Slice the loaves.')).toEqual([[0]]);
  });
  it('level 3: modifiers dropped', () => {
    expect(match(['large eggs'], 'Beat the egg.')).toMatchObject([{ ids: [0], level: 3 }]);
    expect(match(['unsalted butter'], 'Melt the butter.')).toMatchObject([{ ids: [0], level: 3 }]);
    expect(ids(['dark chocolate chunks'], 'Fold in the chocolate chunks.')).toEqual([[0]]);
  });
  it('level 2: synonyms', () => {
    expect(match(['vanilla extract'], 'Add vanilla.')).toMatchObject([{ ids: [0], level: 2 }]);
    expect(ids(['cocoa powder'], 'Sift in the cocoa.')).toEqual([[0]]);
  });
  it('level 4: unique head noun resolves', () => {
    expect(match(['brown sugar'], 'Add the sugar.')).toMatchObject([
      { ids: [0], level: 4, ambiguous: false },
    ]);
  });
  it('level 4: shared head noun is ambiguous', () => {
    const m = match(['brown sugar', 'powdered sugar'], 'Add the sugar.');
    expect(m).toMatchObject([{ ids: [0, 1], level: 4, ambiguous: true }]);
  });
  it('longest phrase wins over the bare noun', () => {
    const m = match(['sugar', 'brown sugar'], 'Mix the brown sugar and the sugar.');
    expect(m.map((x) => x.ids)).toEqual([[1], [0]]);
  });
  it('exact bare name beats head noun of a longer name', () => {
    expect(ids(['sugar', 'brown sugar'], 'Add the sugar.')).toEqual([[0]]);
  });
  it('coriander does not find cilantro and the reverse', () => {
    expect(ids(['cilantro'], 'Add coriander seeds.')).toEqual([]);
    expect(ids(['coriander'], 'Add chopped cilantro.')).toEqual([]);
  });
  it('identical names are the same ingredient, not ambiguity', () => {
    const m = match(['sugar', 'sugar'], 'Add the sugar.');
    expect(m).toMatchObject([{ ids: [0, 1], ambiguous: false }]);
  });
  it('parentheticals in steps are ignored', () => {
    expect(
      ids(['sugar', 'eggs'], 'Add the sugar (see note) and the eggs (room temperature).'),
    ).toEqual([[0], [1]]);
  });
  it('text after a comma in a name is ignored', () => {
    expect(ids(['butter, softened'], 'Cream the butter.')).toEqual([[0]]);
  });
  it('does not match across a different first token', () => {
    expect(ids(['olive oil'], 'Add oil.')).toEqual([[0]]);
    expect(ids(['olive oil', 'sesame oil', 'vegetable oil'], 'Add oil.')).toEqual([[0, 1, 2]]);
  });
});

describe('determinism and budget', () => {
  it('same input twice gives identical output', () => {
    const names = ['butter', 'brown sugar', 'eggs', 'flour'];
    const step = 'Cream the butter and sugar, beat in the eggs, fold in the flour.';
    expect(match(names, step)).toEqual(match(names, step));
  });
  it('shuffled ingredient order gives the same mention set by name', () => {
    const names = ['butter', 'brown sugar', 'eggs', 'flour'];
    const rev = [...names].reverse();
    const step = 'Cream the butter and brown sugar, beat in the eggs, fold in the flour.';
    const a = match(names, step).map((m) => names[m.ids[0]!]);
    const b = match(rev, step).map((m) => rev[m.ids[0]!]);
    expect(a).toEqual(b);
  });
  it('throws BudgetExceeded when the budget is tiny', () => {
    const idx = buildIndex(['sugar']);
    expect(() => findMentions(words('add sugar '.repeat(50)), idx, { used: 0, limit: 5 })).toThrow(
      BudgetExceeded,
    );
  });
});

describe('source hygiene', () => {
  it('does not build regexes from input', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['text-tokens.ts', 'ingredient-match.ts']) {
      expect(readFileSync(`src/lib/import/${f}`, 'utf8')).not.toContain('new RegExp(');
    }
  });
});

describe('verb homonyms (review M1)', () => {
  const run = (names: string[], step: string, verbAt: number[]) =>
    findMentions(words(step), buildIndex(names), budget(), new Set(verbAt));
  it('ignores a single-word match at an imperative verb index', () => {
    expect(run(['cream', 'butter'], 'cream the butter', [0]).map((m) => m.ids)).toEqual([[1]]);
  });
  it('still matches the same word elsewhere in the step', () => {
    expect(run(['cream'], 'whip the cream', [0])).toHaveLength(1);
  });
  it('keeps a multi-word name that starts at a verb index', () => {
    expect(
      run(['cream cheese', 'cream'], 'cream cheese and butter', [0]).map((m) => m.ids),
    ).toEqual([[0]]);
  });
  it('matches as before without verb indexes', () => {
    expect(ids(['cream', 'butter'], 'cream the butter')).toEqual([[0], [1]]);
  });
});
