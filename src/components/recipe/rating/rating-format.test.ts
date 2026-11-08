import { describe, expect, it } from 'vitest';
import { parseMinRating, starFill, withMyRating, withoutMyRating } from './rating-format';

describe('rating-format', () => {
  it('adds a first rating', () => {
    expect(withMyRating({ avg: null, count: 0, mine: null }, 4)).toEqual({
      avg: 4,
      count: 1,
      mine: 4,
    });
  });
  it('adds a rating to others', () => {
    expect(withMyRating({ avg: 3, count: 2, mine: null }, 5)).toEqual({
      avg: 11 / 3,
      count: 3,
      mine: 5,
    });
  });
  it('replaces my rating without changing the count', () => {
    expect(withMyRating({ avg: 4, count: 2, mine: 3 }, 5)).toEqual({ avg: 5, count: 2, mine: 5 });
  });
  it('clears my rating', () => {
    expect(withoutMyRating({ avg: 4, count: 2, mine: 3 })).toEqual({
      avg: 5,
      count: 1,
      mine: null,
    });
    expect(withoutMyRating({ avg: 4, count: 1, mine: 4 })).toEqual({
      avg: null,
      count: 0,
      mine: null,
    });
    const none = { avg: 4, count: 1, mine: null };
    expect(withoutMyRating(none)).toBe(none);
  });
  it('fills stars fractionally', () => {
    expect(starFill(null, 1)).toBe(0);
    expect(starFill(4.3, 5)).toBeCloseTo(0.3);
    expect(starFill(4.3, 4)).toBe(1);
    expect(starFill(2, 3)).toBe(0);
  });
  it('parses min_rating like the API', () => {
    expect(parseMinRating('4')).toBe(4);
    expect(parseMinRating('1')).toBe(1);
    for (const bad of ['0', '6', '3.5', 'x', '', undefined]) {
      expect(parseMinRating(bad)).toBeUndefined();
    }
  });
});
