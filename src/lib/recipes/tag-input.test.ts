import { describe, expect, it } from 'vitest';
import {
  addMany,
  addTag,
  autocompleteUrl,
  moveActive,
  parseTagsResponse,
  removeTag,
  splitTagText,
  tagProblem,
  visibleSuggestions,
} from './tag-input';
import { MAX_TAGS_PER_RECIPE, normalizeTagName } from './tag-name';

describe('tagProblem', () => {
  it('is null for blank and valid text', () => {
    expect(tagProblem('')).toBeNull();
    expect(tagProblem('   ')).toBeNull();
    expect(tagProblem('Dessert')).toBeNull();
  });
  it('flags over-long text by code points and invisible characters', () => {
    expect(tagProblem('a'.repeat(40))).toBeNull();
    expect(tagProblem('a'.repeat(41))).toBe('too_long');
    expect(tagProblem('🍰'.repeat(40))).toBeNull();
    expect(tagProblem('🍰'.repeat(41))).toBe('too_long');
    expect(tagProblem('a​b')).toBe('invalid');
    expect(tagProblem('a\u0000b')).toBe('invalid');
  });
});

describe('addTag', () => {
  it('normalizes like the server', () => {
    for (const raw of ['  Dessert ', 'DESSERT', 'deśsert', 'Sweet   Treat']) {
      const r = addTag([], raw);
      expect(r.ok && r.name).toBe(normalizeTagName(raw));
    }
  });
  it('collapses duplicates without adding', () => {
    const r = addTag(['dessert'], '  DESSERT ');
    expect(r).toEqual({ ok: true, tags: ['dessert'], name: 'dessert', added: false });
  });
  it('reports empty, too long, invalid and the 20 tag limit', () => {
    expect(addTag([], '  ')).toEqual({ ok: false, problem: 'empty' });
    expect(addTag([], 'x'.repeat(41))).toEqual({ ok: false, problem: 'too_long' });
    expect(addTag([], 'a‮b')).toEqual({ ok: false, problem: 'invalid' });
    const full = Array.from({ length: MAX_TAGS_PER_RECIPE }, (_, i) => `t${i}`);
    expect(addTag(full, 'extra')).toEqual({ ok: false, problem: 'limit' });
    expect(addTag(full, 't3').ok).toBe(true);
  });
  it('does not mutate its input', () => {
    const tags = ['a'];
    addTag(tags, 'b');
    expect(tags).toEqual(['a']);
  });
});

describe('addMany / splitTagText', () => {
  it('splits on commas, semicolons and newlines', () => {
    expect(splitTagText('a, b;c\n d ,, ')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('adds valid parts and returns rejected ones', () => {
    const r = addMany(['a'], 'b, A, ' + 'x'.repeat(41) + ', c');
    expect(r.tags).toEqual(['a', 'b', 'c']);
    expect(r.added).toEqual(['b', 'c']);
    expect(r.rejected).toEqual(['x'.repeat(41)]);
    expect(r.problem).toBe('too_long');
  });
  it('stops at the limit', () => {
    const r = addMany(
      Array.from({ length: 19 }, (_, i) => `t${i}`),
      'x, y',
    );
    expect(r.tags).toHaveLength(20);
    expect(r.rejected).toEqual(['y']);
    expect(r.problem).toBe('limit');
  });
});

describe('removeTag / visibleSuggestions', () => {
  it('removes by name', () => expect(removeTag(['a', 'b'], 'a')).toEqual(['b']));
  it('hides chosen and repeated suggestions and caps at 10', () => {
    expect(visibleSuggestions(['a', 'b', 'b', 'c'], ['a'])).toEqual(['b', 'c']);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(visibleSuggestions(many, [])).toHaveLength(10);
  });
});

describe('moveActive', () => {
  it('wraps and handles an empty list', () => {
    expect(moveActive(-1, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(2, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(-1, 3, 'ArrowUp')).toBe(2);
    expect(moveActive(0, 3, 'ArrowUp')).toBe(2);
    expect(moveActive(1, 3, 'ArrowUp')).toBe(0);
    expect(moveActive(0, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('parseTagsResponse / autocompleteUrl', () => {
  it('extracts names and ignores malformed bodies', () => {
    expect(parseTagsResponse({ tags: [{ name: 'a', count: 1 }, { name: 3 }, null, {}] })).toEqual([
      'a',
    ]);
    expect(parseTagsResponse(null)).toEqual([]);
    expect(parseTagsResponse({ tags: 'x' })).toEqual([]);
  });
  it('builds an encoded lowercase url, or null when nothing should be fetched', () => {
    expect(autocompleteUrl('  Des & ')).toBe('/api/tags?q=des%20%26');
    expect(autocompleteUrl('  ')).toBeNull();
    expect(autocompleteUrl('x'.repeat(41))).toBeNull();
  });
});
