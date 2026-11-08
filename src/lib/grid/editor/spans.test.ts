import { describe, expect, it } from 'vitest';
import {
  clampSpan,
  defaultSpan,
  deleteRowSpans,
  insertRowSpans,
  mapMovedRow,
  moveRowSpans,
  rowsCovered,
  splitRowSpans,
  uncoveredRows,
  type SpanStep,
} from './spans';

const c = (s: number, e: number): SpanStep => ({ kind: 'column', row_start: s, row_end: e });
const banner: SpanStep = { kind: 'banner_top', row_start: null, row_end: null };
const sp = (steps: SpanStep[]) =>
  steps.map((t) => (t.kind === 'column' ? [t.row_start, t.row_end] : null));
const NESTED: [number, number][] = [
  [0, 0],
  [0, 3],
  [0, 4],
  [0, 8],
];

describe('moveRowSpans (G6a, Q1: spans follow the ingredients)', () => {
  // [from, to, span, expected]
  const cases: [number, number, [number, number], [number, number]][] = [
    [0, 1, [0, 0], [1, 1]],
    [1, 0, [0, 0], [1, 1]],
    [3, 0, [0, 3], [0, 3]],
    [5, 0, [0, 3], [1, 4]],
    [0, 5, [0, 3], [0, 5]],
    [8, 4, [0, 3], [0, 3]],
    [2, 6, [3, 5], [2, 4]],
    [6, 2, [3, 5], [4, 6]],
    [8, 0, [0, 8], [0, 8]],
    [0, 8, [0, 8], [0, 8]],
    [0, 8, [0, 0], [8, 8]],
    [8, 0, [8, 8], [0, 0]],
    [2, 3, [2, 3], [2, 3]],
    [1, 2, [2, 2], [1, 1]],
    [2, 1, [1, 1], [2, 2]],
    [3, 1, [0, 0], [0, 0]],
    [3, 1, [2, 2], [3, 3]],
    [0, 4, [1, 3], [0, 2]],
    [4, 0, [1, 3], [2, 4]],
    [4, 1, [2, 5], [1, 5]],
  ];
  it.each(cases)('move %i -> %i with span %j gives %j', (from, to, span, expected) => {
    expect(sp(moveRowSpans([c(...span)], from, to))).toEqual([expected]);
  });

  it('moves rows under the nested sample spans (first row to the end widens all but the last)', () => {
    expect(
      sp(
        moveRowSpans(
          NESTED.map(([a, b]) => c(a, b)),
          0,
          8,
        ),
      ),
    ).toEqual([
      [8, 8],
      [0, 8],
      [0, 8],
      [0, 8],
    ]);
  });

  it('leaves banners untouched and keeps unchanged steps referentially equal', () => {
    const steps = [banner, c(5, 6)];
    const out = moveRowSpans(steps, 0, 2);
    expect(out[0]).toBe(banner);
    expect(out[1]).toBe(steps[1]);
  });

  it('mapMovedRow is a permutation of 0..n-1', () => {
    for (const [from, to] of [
      [0, 4],
      [4, 0],
      [2, 3],
      [3, 2],
    ]) {
      const mapped = [0, 1, 2, 3, 4].map((p) => mapMovedRow(p, from, to)).sort();
      expect(mapped).toEqual([0, 1, 2, 3, 4]);
    }
  });
});

describe('deleteRowSpans (G6b, Q2: a span left with no rows is removed)', () => {
  const cases: [number, [number, number], [number, number] | 'removed'][] = [
    [0, [0, 0], 'removed'],
    [0, [0, 3], [0, 2]],
    [3, [0, 3], [0, 2]],
    [2, [0, 3], [0, 2]],
    [4, [0, 3], [0, 3]],
    [0, [2, 4], [1, 3]],
    [8, [0, 8], [0, 7]],
    [5, [5, 5], 'removed'],
    [5, [5, 6], [5, 5]],
    [5, [4, 5], [4, 4]],
    [1, [2, 2], [1, 1]],
    [7, [2, 2], [2, 2]],
  ];
  it.each(cases)('delete row %i with span %j gives %j', (row, span, expected) => {
    const r = deleteRowSpans([c(...span)], row);
    if (expected === 'removed') {
      expect(r.steps).toEqual([]);
      expect(r.removed).toHaveLength(1);
    } else {
      expect(sp(r.steps)).toEqual([expected]);
      expect(r.removed).toEqual([]);
    }
  });

  it('nested sample spans: deleting row 0 removes only the 0-0 step', () => {
    const r = deleteRowSpans(
      NESTED.map(([a, b]) => c(a, b)),
      0,
    );
    expect(sp(r.steps)).toEqual([
      [0, 2],
      [0, 3],
      [0, 7],
    ]);
    expect(r.removed).toHaveLength(1);
  });
});

describe('insertRowSpans (G6c: covered only when strictly inside)', () => {
  const cases: [number, [number, number], [number, number]][] = [
    [0, [0, 3], [1, 4]],
    [1, [0, 3], [0, 4]],
    [3, [0, 3], [0, 4]],
    [4, [0, 3], [0, 3]],
    [0, [0, 0], [1, 1]],
    [1, [0, 0], [0, 0]],
    [2, [2, 4], [3, 5]],
    [3, [2, 4], [2, 5]],
    [5, [2, 4], [2, 4]],
    [9, [0, 8], [0, 8]],
  ];
  it.each(cases)('insert at %i with span %j gives %j', (at, span, expected) => {
    expect(sp(insertRowSpans([c(...span)], at))).toEqual([expected]);
  });
});

describe('splitRowSpans (G6d: covering steps cover both portions)', () => {
  const cases: [number, [number, number], [number, number]][] = [
    [0, [0, 0], [0, 1]],
    [2, [0, 3], [0, 4]],
    [3, [0, 3], [0, 4]],
    [0, [0, 3], [0, 4]],
    [4, [0, 3], [0, 3]],
    [1, [2, 3], [3, 4]],
    [2, [2, 3], [2, 4]],
    [8, [0, 8], [0, 9]],
  ];
  it.each(cases)('split row %i with span %j gives %j', (row, span, expected) => {
    expect(sp(splitRowSpans([c(...span)], row))).toEqual([expected]);
  });
});

describe('coverage helpers', () => {
  it('clampSpan clamps, orders and refuses an empty section', () => {
    expect(clampSpan(-3, 20, 9)).toEqual({ start: 0, end: 8 });
    expect(clampSpan(5, 2, 9)).toEqual({ start: 2, end: 5 });
    expect(clampSpan(0, 0, 0)).toBeNull();
    expect(clampSpan(Number.NaN, 1, 4)).toBeNull();
  });
  it('rowsCovered / uncoveredRows ignore banners and out-of-range bounds', () => {
    const steps = [banner, c(1, 2), c(6, 99)];
    expect(rowsCovered(steps, 5)).toEqual([false, true, true, false, false]);
    expect(uncoveredRows(steps, 5)).toEqual([0, 3, 4]);
    expect(uncoveredRows([], 0)).toEqual([]);
  });
  it('defaultSpan: first uncovered row, else all rows, else null', () => {
    expect(defaultSpan([c(0, 1)], 4)).toEqual({ start: 2, end: 2 });
    expect(defaultSpan([c(0, 3)], 4)).toEqual({ start: 0, end: 3 });
    expect(defaultSpan([], 0)).toBeNull();
  });
});
