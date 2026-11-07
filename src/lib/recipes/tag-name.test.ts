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

describe('normalizeTagName: invisible and spoofing characters (checkpoint F2)', () => {
  it.each([
    ['zero-width space', 'a​b'],
    ['right-to-left override', 'a‮b'],
    ['left-to-right mark', 'a‎b'],
    ['bidi isolate', 'a⁦b⁩'],
    ['word joiner', 'a⁠b'],
    ['soft hyphen', 'a­b'],
    ['tag character', 'a\u{E0041}b'],
    ['lone surrogate', 'a\uD800b'],
    ['private use', 'ab'],
    ['unassigned', 'a͸b'],
  ])('rejects %s', (_label, raw) => expect(normalizeTagName(raw)).toBeNull());

  it('keeps ZWNJ and ZWJ (Persian, Indic scripts, emoji sequences)', () => {
    expect(normalizeTagName('می‌خواهم')).not.toBeNull();
    expect(normalizeTagName('\u{1F468}‍\u{1F373}')).not.toBeNull();
  });

  it('trims a leading BOM like any other whitespace', () => {
    expect(normalizeTagName('﻿a')).toBe('a');
  });
});
