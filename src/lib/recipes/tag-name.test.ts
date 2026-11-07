import { describe, expect, it } from 'vitest';
import { normalizeTagList, normalizeTagName } from './tag-name';

describe('normalizeTagName', () => {
  it.each([
    ['Dessert', 'dessert'],
    ['  dessert  ', 'dessert'],
    ['Main \t  Course\n', 'main course'],
    ['CRÈME', 'crème'],
    // NFD input (e + combining acute) becomes the NFC code point
    ['café', 'café'],
    ['a'.repeat(40), 'a'.repeat(40)],
  ])('%j -> %j', (raw, out) => expect(normalizeTagName(raw)).toBe(out));

  it.each([[''], ['   '], ['a'.repeat(41)], ['bad\u0000tag'], ['bad\u0007tag'], ['bad\u007ftag']])(
    'rejects %j',
    (raw) => expect(normalizeTagName(raw)).toBeNull(),
  );

  it('counts code points, not UTF-16 units, for the 40 limit', () => {
    expect(normalizeTagName('\u{1F370}'.repeat(40))).not.toBeNull();
    expect(normalizeTagName('\u{1F370}'.repeat(41))).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normalizeTagName(5 as unknown as string)).toBeNull();
  });
});

describe('normalizeTagList', () => {
  it('normalizes, drops invalid, dedupes keeping first position, caps', () => {
    expect(normalizeTagList(['Dessert', ' dessert ', 'chocolate', '', 'x'.repeat(50)])).toEqual([
      'dessert',
      'chocolate',
    ]);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeTagList(many)).toHaveLength(20);
  });
});
