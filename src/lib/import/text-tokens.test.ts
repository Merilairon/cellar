import { describe, expect, it } from 'vitest';
import { singularize, stripParentheticals, tokenize, tokenizeDetailed } from './text-tokens';

describe('singularize', () => {
  const rows: Array<[string, string]> = [
    ['eggs', 'egg'],
    ['egg', 'egg'],
    ['tomatoes', 'tomato'],
    ['potatoes', 'potato'],
    ['leaves', 'leaf'],
    ['loaves', 'loaf'],
    ['halves', 'half'],
    ['knives', 'knife'],
    ['berries', 'berry'],
    ['cherries', 'cherry'],
    ['cookies', 'cookie'],
    ['brownies', 'brownie'],
    ['cloves', 'clove'],
    ['olives', 'olive'],
    ['peaches', 'peach'],
    ['radishes', 'radish'],
    ['boxes', 'box'],
    ['glasses', 'glass'],
    ['cheeses', 'cheese'],
    ['onions', 'onion'],
    ['peas', 'pea'],
    ['molasses', 'molasses'],
    ['asparagus', 'asparagus'],
    ['lemongrass', 'lemongrass'],
    ['couscous', 'couscous'],
    ['hummus', 'hummus'],
    ['swiss', 'swiss'],
    ['glass', 'glass'],
    ['citrus', 'citrus'],
    ['oats', 'oats'],
    ['was', 'was'],
    ['gas', 'gas'],
    ['', ''],
  ];
  it.each(rows)('%s -> %s', (a, b) => expect(singularize(a)).toBe(b));
});

describe('tokenize', () => {
  const rows: Array<[string, string[]]> = [
    ['Melt the butter.', ['melt', 'the', 'butter']],
    ['butter (softened)', ['butter']],
    ['sugar (see note) and eggs', ['sugar', 'and', 'eggs']],
    ['a (b (c)) d', ['a', 'd']],
    ['a (b', ['a', 'b']],
    ['a ) b', ['a', 'b']],
    ["confectioners' sugar", ['confectioners', 'sugar']],
    ['baker’s chocolate', ['bakers', 'chocolate']],
    ['1/2 cup', ['1', '2', 'cup']],
    ['all-purpose flour', ['all', 'purpose', 'flour']],
    ['Crème fraîche', ['crème', 'fraîche']],
    ['zero​width', ['zerowidth']],
    ['', []],
  ];
  it.each(rows)('%j', (text, words) => expect(tokenize(text)).toEqual(words));

  it('tracks sentences and clauses', () => {
    const t = tokenizeDetailed('In a bowl, whisk eggs. Bake 1.5 hours; cool.').tokens;
    expect(t.map((x) => [x.w, x.sent, x.clause])).toEqual([
      ['in', 0, 0],
      ['a', 0, 0],
      ['bowl', 0, 0],
      ['whisk', 0, 1],
      ['eggs', 0, 1],
      ['bake', 1, 0],
      ['1', 1, 0],
      ['5', 1, 0],
      ['hours', 1, 0],
      ['cool', 2, 0],
    ]);
  });

  it('is linear and total on 4000 open parentheses', () => {
    const t0 = performance.now();
    expect(tokenize('('.repeat(4000) + 'sugar')).toEqual(['sugar']);
    expect(tokenize('a'.repeat(4000) + ')'.repeat(4000))).toHaveLength(1);
    expect(tokenize('('.repeat(2000) + ')'.repeat(2000))).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('caps tokens and reports truncation', () => {
    const r = tokenizeDetailed('a b c d e', 3);
    expect(r.tokens).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });
});

describe('stripParentheticals', () => {
  it('removes balanced spans only', () => {
    expect(stripParentheticals('butter (softened) cold').replace(/\s+/g, ' ')).toBe('butter cold');
    expect(stripParentheticals('a (b')).toBe('a (b');
    expect(stripParentheticals('a ) b')).toBe('a ) b');
  });
});
