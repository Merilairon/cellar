import { describe, expect, it } from 'vitest';
import { bottom, col, make, top } from '@/lib/grid/editor/fixtures';
import { doc } from '@/lib/grid/editor';
import {
  bannerId,
  defaultTarget,
  navigate,
  rowId,
  stepId,
  targetsFor,
  type NavKey,
} from './roving';

// 4 rows; banners top x2 and bottom x1; columns: A rows 0-1, B rows 1-3, C rows 3-3.
const section = () =>
  doc(make(4, [top('t1'), top('t2'), col(0, 1, 'A'), col(1, 3, 'B'), col(3, 3, 'C'), bottom('b1')]))
    .sections[0];
const s = section();
const targets = targetsFor(s);
const key = (kind: 'row' | 'step' | 'banner', label: string) => {
  if (kind === 'row') return rowId(s.ingredients.find((i) => i.name === label)!.key);
  const st = s.steps.find((x) => x.label === label)!;
  return kind === 'step' ? stepId(st.key) : bannerId(st.key);
};
const go = (from: string, k: NavKey, ctrl = false) => {
  const r = navigate(targets, from, k, ctrl);
  return r?.type === 'focus' ? r.id : r;
};

describe('roving targets', () => {
  it('lists banners, rows and column steps; one default tab stop', () => {
    expect(targets.filter((t) => t.kind === 'row')).toHaveLength(4);
    expect(targets.filter((t) => t.kind === 'banner')).toHaveLength(3);
    expect(targets.filter((t) => t.kind === 'step')).toHaveLength(3);
    expect(defaultTarget(targets)).toBe(key('row', 'r0'));
  });
  it('default falls back to a banner, then anything, then null', () => {
    const only = targetsFor(doc(make(0, [top('t')])).sections[0]);
    expect(defaultTarget(only)).toBe(only[0].id);
    expect(defaultTarget([])).toBeNull();
  });
});

describe('roving navigation', () => {
  it('rows: up/down within the column, Home/End, then banners at the ends', () => {
    expect(go(key('row', 'r0'), 'ArrowDown')).toBe(key('row', 'r1'));
    expect(go(key('row', 'r3'), 'ArrowUp')).toBe(key('row', 'r2'));
    expect(go(key('row', 'r1'), 'Home')).toBe(key('row', 'r0'));
    expect(go(key('row', 'r1'), 'End')).toBe(key('row', 'r3'));
    expect(go(key('row', 'r3'), 'ArrowDown')).toBe(key('banner', 'b1'));
    expect(go(key('row', 'r0'), 'ArrowUp')).toBe(key('banner', 't2'));
  });
  it('row ArrowRight goes to the first step covering the row, ArrowLeft stays', () => {
    expect(go(key('row', 'r0'), 'ArrowRight')).toBe(key('step', 'A'));
    expect(go(key('row', 'r2'), 'ArrowRight')).toBe(key('step', 'B'));
    expect(go(key('row', 'r0'), 'ArrowLeft')).toBeNull();
  });
  it('step Right needs a later column covering its first row; Left falls back to the row', () => {
    expect(go(key('step', 'A'), 'ArrowRight')).toBeNull(); // B starts below A's first row
    expect(go(key('step', 'B'), 'ArrowRight')).toBeNull(); // C does not cover row 1
    expect(go(key('step', 'B'), 'ArrowLeft')).toBe(key('step', 'A')); // A covers row 1
    expect(go(key('step', 'C'), 'ArrowLeft')).toBe(key('step', 'B'));
    expect(go(key('step', 'A'), 'ArrowLeft')).toBe(key('row', 'r0'));
    expect(go(key('step', 'B'), 'Home')).toBe(key('step', 'A'));
    expect(go(key('step', 'A'), 'End')).toBe(key('step', 'C'));
    expect(go(key('step', 'B'), 'ArrowDown')).toBeNull();
  });
  it('banners walk their group, join the rows at the seam, and stay at the outer ends', () => {
    expect(go(key('banner', 't1'), 'ArrowDown')).toBe(key('banner', 't2'));
    expect(go(key('banner', 't2'), 'ArrowDown')).toBe(key('row', 'r0'));
    expect(go(key('banner', 't1'), 'ArrowUp')).toBeNull();
    expect(go(key('banner', 'b1'), 'ArrowUp')).toBe(key('row', 'r3'));
    expect(go(key('banner', 'b1'), 'ArrowDown')).toBeNull();
  });
  it('Ctrl+Home / Ctrl+End jump to the first / last target in reading order', () => {
    expect(go(key('row', 'r2'), 'Home', true)).toBe(key('banner', 't1'));
    expect(go(key('row', 'r2'), 'End', true)).toBe(key('banner', 'b1'));
  });
  it('PageDown / PageUp ask the parent for the neighbouring section', () => {
    expect(go(key('row', 'r0'), 'PageDown')).toEqual({ type: 'section', dir: 1 });
    expect(go(key('step', 'B'), 'PageUp')).toEqual({ type: 'section', dir: -1 });
  });
  it('an unknown current target is a no-op', () => {
    expect(navigate(targets, 'row:nope', 'ArrowDown')).toBeNull();
  });
});
