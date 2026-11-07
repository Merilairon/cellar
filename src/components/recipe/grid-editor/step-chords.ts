// Pure chord table for step cells and banners (UX spec 4.3, 8.5, 14.4). Key event in, an
// editor action (or an explained no-op) out. The component calls preventDefault whenever
// `handled` is true, so the browser's Alt+Left/Right history shortcut never fires over a target.

import type { EditorAction, EditorSection } from '@/lib/grid/editor';
import type { RovingTarget } from './roving';

export type NoopReason =
  | 'startAtFirst'
  | 'endAtLast'
  | 'minOneRow'
  | 'columnEdge'
  | 'bannerEdge'
  | 'spanEdge';

export type ChordKey = {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export type ChordResult =
  | { handled: false }
  | { handled: true; action: EditorAction; noop?: undefined }
  | { handled: true; action?: undefined; noop?: NoopReason };

const NO: ChordResult = { handled: false };
const swallow: ChordResult = { handled: true };

export function stepChord(
  k: ChordKey,
  target: RovingTarget,
  section: EditorSection,
  si: number,
): ChordResult {
  if (k.ctrlKey || k.metaKey) return NO;
  const { altKey: alt, shiftKey: shift, key } = k;
  if (!alt && !shift) return NO;

  // Alt+Left/Right is browser history: swallow it over every roving target (O4).
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  if (!horizontal && !vertical) return NO;
  if (target.kind === 'row') return horizontal && alt ? swallow : NO;

  const idx = section.steps.findIndex((s) => s.key === target.key);
  const step = section.steps[idx];
  if (!step) return NO;
  const n = section.ingredients.length;
  const up = key === 'ArrowUp' || key === 'ArrowLeft';
  const d = up ? -1 : 1;

  if (target.kind === 'step') {
    if (step.row_start === null || step.row_end === null) return horizontal && alt ? swallow : NO;
    const { row_start: a, row_end: b } = step;
    if (alt && shift) {
      if (!vertical) return NO;
      if (a + d < 0 || b + d > n - 1) return { handled: true, noop: 'spanEdge' };
      return {
        handled: true,
        action: { type: 'stepSetSpan', section: si, step: idx, start: a + d, end: b + d },
      };
    }
    if (alt && vertical) {
      if (up) {
        return a <= 0
          ? { handled: true, noop: 'startAtFirst' }
          : { handled: true, action: { type: 'stepGrowStart', section: si, step: idx } };
      }
      return a >= b
        ? { handled: true, noop: 'minOneRow' }
        : { handled: true, action: { type: 'stepShrinkStart', section: si, step: idx } };
    }
    if (shift && vertical) {
      if (up) {
        return b <= a
          ? { handled: true, noop: 'minOneRow' }
          : { handled: true, action: { type: 'stepShrinkEnd', section: si, step: idx } };
      }
      return b >= n - 1
        ? { handled: true, noop: 'endAtLast' }
        : { handled: true, action: { type: 'stepGrowEnd', section: si, step: idx } };
    }
    if (alt && horizontal) {
      const to = idx + d;
      if (section.steps[to]?.kind !== 'column') return { handled: true, noop: 'columnEdge' };
      return { handled: true, action: { type: 'stepMove', section: si, step: idx, to } };
    }
    return NO;
  }

  // Banner: Alt+Up/Down moves inside its own group (top banners stay top banners).
  if (alt && !shift && vertical) {
    const to = idx + d;
    if (section.steps[to]?.kind !== step.kind) return { handled: true, noop: 'bannerEdge' };
    return { handled: true, action: { type: 'stepMove', section: si, step: idx, to } };
  }
  return horizontal && alt && !shift ? swallow : NO;
}
