import { describe, expect, it } from 'vitest';
import {
  autoScrollSpeed,
  boundaryFromY,
  dragCancel,
  dragEnd,
  dragMove,
  dragStart,
  rowFromY,
  sliderKey,
  spanForBoundary,
  type RowRect,
} from './span-drag';

// Nine rows, 50 px each, 4 px gaps: row i spans [i*54, i*54+50).
const rects: RowRect[] = Array.from({ length: 9 }, (_, i) => ({
  top: i * 54,
  bottom: i * 54 + 50,
}));

describe('rowFromY', () => {
  it('finds the containing row and clamps outside the table', () => {
    expect(rowFromY(rects, 10)).toBe(0);
    expect(rowFromY(rects, 54 * 3 + 20)).toBe(3);
    expect(rowFromY(rects, -100)).toBe(0);
    expect(rowFromY(rects, 5000)).toBe(8);
    expect(rowFromY([], 5)).toBe(0);
  });
  it('picks the nearer row inside a gap', () => {
    expect(rowFromY(rects, 51)).toBe(0);
    expect(rowFromY(rects, 53)).toBe(1);
  });
});

describe('boundaryFromY', () => {
  it('snaps to the nearest row boundary, including the bottom of the last row', () => {
    expect(boundaryFromY(rects, 0)).toBe(0);
    expect(boundaryFromY(rects, 54 * 4 + 30)).toBe(5);
    expect(boundaryFromY(rects, 54 * 4 + 10)).toBe(4);
    expect(boundaryFromY(rects, 9999)).toBe(9);
    expect(boundaryFromY(rects, -50)).toBe(0);
  });
});

describe('spanForBoundary clamping', () => {
  const span = { start: 2, end: 5 };
  it('bottom edge to boundary b sets end = b - 1, never above start, never past the last row', () => {
    expect(spanForBoundary('end', 4, span, 9)).toEqual({ start: 2, end: 3 });
    expect(spanForBoundary('end', 0, span, 9)).toEqual({ start: 2, end: 2 });
    expect(spanForBoundary('end', 9, span, 9)).toEqual({ start: 2, end: 8 });
  });
  it('top edge cannot cross the bottom handle or leave the section', () => {
    expect(spanForBoundary('start', 7, span, 9)).toEqual({ start: 5, end: 5 });
    expect(spanForBoundary('start', 0, span, 9)).toEqual({ start: 0, end: 5 });
  });
});

describe('sliderKey', () => {
  const span = { start: 2, end: 5 };
  it('moves one row, five rows, or to the ends within the clamp rules', () => {
    expect(sliderKey('end', 'ArrowDown', span, 9)).toEqual({ start: 2, end: 6 });
    expect(sliderKey('end', 'ArrowUp', span, 9)).toEqual({ start: 2, end: 4 });
    expect(sliderKey('end', 'PageDown', span, 9)).toEqual({ start: 2, end: 8 });
    expect(sliderKey('end', 'Home', span, 9)).toEqual({ start: 2, end: 2 });
    expect(sliderKey('start', 'Home', span, 9)).toEqual({ start: 0, end: 5 });
    expect(sliderKey('start', 'End', span, 9)).toEqual({ start: 5, end: 5 });
    expect(sliderKey('start', 'a', span, 9)).toBeNull();
  });
});

describe('drag state machine (bake: row 9 to row 4)', () => {
  const a = {
    sectionKey: 's',
    stepKey: 'bake',
    edge: 'end' as const,
    origin: { start: 0, end: 8 },
    rows: 9,
  };
  const bottomOf = (row: number) => rects[row].bottom;

  it('a click without movement commits nothing', () => {
    let s = dragStart(a, bottomOf(8));
    s = dragMove(s, bottomOf(8) + 2, rects);
    expect(s.phase).toBe('pending');
    expect(dragEnd(s).commit).toBeNull();
  });

  it('dragging the bottom handle from row 9 up to row 4 commits end = 3', () => {
    let s = dragStart(a, bottomOf(8));
    s = dragMove(s, bottomOf(3), rects);
    expect(s.phase).toBe('dragging');
    const r = dragEnd(s);
    expect(r.commit).toEqual({ start: 0, end: 3 });
    expect(r.state.phase).toBe('idle');
  });

  it('drag above the top handle clamps to one row; below the table clamps to the last row', () => {
    let s = dragStart({ ...a, origin: { start: 2, end: 6 } }, bottomOf(6));
    s = dragMove(s, -500, rects);
    expect(s.phase === 'dragging' && s.preview).toEqual({ start: 2, end: 2 });
    s = dragMove(s, 9000, rects);
    expect(s.phase === 'dragging' && s.preview).toEqual({ start: 2, end: 8 });
  });

  it('dragging back to the origin commits nothing; Escape restores and commits nothing', () => {
    let s = dragStart(a, bottomOf(8));
    s = dragMove(s, bottomOf(3), rects);
    s = dragMove(s, bottomOf(8), rects);
    expect(dragEnd(s).commit).toBeNull();
    expect(dragCancel().phase).toBe('idle');
  });
});

describe('autoScrollSpeed', () => {
  it('is zero in the middle, proportional near the edges, signed by direction', () => {
    expect(autoScrollSpeed(400, 800)).toBe(0);
    expect(autoScrollSpeed(799, 800)).toBeGreaterThan(15);
    expect(autoScrollSpeed(780, 800)).toBeGreaterThan(0);
    expect(autoScrollSpeed(0, 800)).toBe(-20);
    expect(autoScrollSpeed(60, 800, 40)).toBeLessThan(0); // toolbar inset moves the top zone down
  });
});
