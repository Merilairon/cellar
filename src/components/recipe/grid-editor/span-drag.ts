// Pure geometry and state machine for dragging a step's span handle (UX spec 4.2). No DOM,
// React or timers: the hook feeds it pointer y values and the table's row rects, so the
// snapping, clamping, threshold and cancel rules are unit tested without a browser.

import type { Span } from '@/lib/grid/editor';

export type RowRect = { top: number; bottom: number };
export type Edge = 'start' | 'end';

/** The 0-based row that contains `y`; above or below the table clamps, a gap picks the nearest. */
export function rowFromY(rects: RowRect[], y: number): number {
  if (rects.length === 0) return 0;
  if (y <= rects[0].top) return 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (y >= r.top && y < r.bottom) return i;
    const next = rects[i + 1];
    if (next && y >= r.bottom && y < next.top) return y - r.bottom <= next.top - y ? i : i + 1;
  }
  return rects.length - 1;
}

/**
 * The row boundary nearest to `y`: 0 is the top of row 0, `n` is the bottom of the last row.
 * A dragged edge snaps to a boundary, not to the row under the pointer, so a handle that sits
 * on a boundary does not jump a whole row after a few pixels.
 */
export function boundaryFromY(rects: RowRect[], y: number): number {
  const n = rects.length;
  if (n === 0) return 0;
  let best = 0;
  let bestD = Math.abs(y - rects[0].top);
  for (let i = 1; i <= n; i++) {
    const at = i === n ? rects[n - 1].bottom : rects[i].top;
    const d = Math.abs(y - at);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Move one edge to `row` with the clamp rules: minimum one row, inside 0..n-1. */
export function moveEdge(edge: Edge, row: number, span: Span, n: number): Span {
  return edge === 'start'
    ? { start: clamp(row, 0, span.end), end: span.end }
    : { start: span.start, end: clamp(row, span.start, n - 1) };
}

/** The span after dragging `edge` to a row boundary (see `boundaryFromY`). */
export function spanForBoundary(edge: Edge, boundary: number, span: Span, n: number): Span {
  return moveEdge(edge, edge === 'start' ? boundary : boundary - 1, span, n);
}

/** Slider keys (UX spec 4.4). `null` when the key is not a slider key. */
export function sliderKey(edge: Edge, key: string, span: Span, n: number): Span | null {
  const cur = edge === 'start' ? span.start : span.end;
  switch (key) {
    case 'ArrowUp':
      return moveEdge(edge, cur - 1, span, n);
    case 'ArrowDown':
      return moveEdge(edge, cur + 1, span, n);
    case 'PageUp':
      return moveEdge(edge, cur - 5, span, n);
    case 'PageDown':
      return moveEdge(edge, cur + 5, span, n);
    case 'Home':
      return moveEdge(edge, 0, span, n);
    case 'End':
      return moveEdge(edge, n - 1, span, n);
    default:
      return null;
  }
}

export const DRAG_THRESHOLD = 3;

export type DragState =
  | { phase: 'idle' }
  | {
      phase: 'pending' | 'dragging';
      sectionKey: string;
      stepKey: string;
      edge: Edge;
      origin: Span;
      rows: number;
      startY: number;
      preview: Span;
    };

export const IDLE: DragState = { phase: 'idle' };

export function dragStart(
  a: { sectionKey: string; stepKey: string; edge: Edge; origin: Span; rows: number },
  y: number,
): DragState {
  return { phase: 'pending', ...a, startY: y, preview: a.origin };
}

/** A pending drag turns into a drag only after 3 px of movement; then the preview follows. */
export function dragMove(s: DragState, y: number, rects: RowRect[]): DragState {
  if (s.phase === 'idle') return s;
  if (s.phase === 'pending' && Math.abs(y - s.startY) < DRAG_THRESHOLD) return s;
  const preview = spanForBoundary(s.edge, boundaryFromY(rects, y), s.origin, s.rows);
  if (s.phase === 'dragging' && preview.start === s.preview.start && preview.end === s.preview.end)
    return s;
  return { ...s, phase: 'dragging', preview };
}

/** Pointer up: commit only a real drag whose span differs from the origin. */
export function dragEnd(s: DragState): { state: DragState; commit: Span | null } {
  const same =
    s.phase === 'dragging' && s.preview.start === s.origin.start && s.preview.end === s.origin.end;
  return { state: IDLE, commit: s.phase === 'dragging' && !same ? s.preview : null };
}

/** Escape, pointercancel, lost capture: nothing is committed. */
export const dragCancel = (): DragState => IDLE;

/** Edge scroll speed for a pointer at `y` in a viewport of `height`: px per frame, 0 to 20. */
export function autoScrollSpeed(y: number, height: number, topInset = 0, zone = 48): number {
  const top = topInset + zone;
  if (y < top) return -Math.round(20 * Math.min(1, (top - y) / zone));
  if (y > height - zone) return Math.round(20 * Math.min(1, (y - (height - zone)) / zone));
  return 0;
}
