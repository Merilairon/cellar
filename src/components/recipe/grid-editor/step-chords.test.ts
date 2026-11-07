import { describe, expect, it } from 'vitest';
import { bottom, col, make, top } from '@/lib/grid/editor/fixtures';
import { doc, reduce } from '@/lib/grid/editor';
import { stepChord, type ChordKey } from './step-chords';
import { targetsFor, type RovingTarget } from './roving';

const k = (key: string, m: Partial<ChordKey> = {}): ChordKey => ({
  key,
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...m,
});
const alt = { altKey: true };
const shift = { shiftKey: true };

// 9 rows, two column steps (rows 1-4 and 3-9), one top and two bottom banners.
const state = make(9, [top('t1'), col(0, 3, 'mix'), col(2, 8, 'bake'), bottom('b1'), bottom('b2')]);
const section = doc(state).sections[0];
const targets = targetsFor(section);
const stepTarget = (label: string): RovingTarget =>
  targets.find(
    (t) => t.kind === 'step' && t.key === section.steps.find((s) => s.label === label)!.key,
  )!;
const bannerTarget = (label: string): RovingTarget =>
  targets.find(
    (t) => t.kind === 'banner' && t.key === section.steps.find((s) => s.label === label)!.key,
  )!;

const run = (key: string, m: Partial<ChordKey>, tg: RovingTarget) => {
  const r = stepChord(k(key, m), tg, section, 0);
  const next = r.action ? doc(reduce(state, r.action)).sections[0] : null;
  return { r, next };
};

describe('step span chords', () => {
  it('Shift+Down grows the bottom edge, Shift+Up shrinks it', () => {
    const { next } = run('ArrowDown', shift, stepTarget('mix'));
    expect(next!.steps.find((s) => s.label === 'mix')!.row_end).toBe(4);
    const up = run('ArrowUp', shift, stepTarget('mix'));
    expect(up.next!.steps.find((s) => s.label === 'mix')!.row_end).toBe(2);
  });
  it('Alt+Up grows the top edge, Alt+Down shrinks it', () => {
    const g = run('ArrowUp', alt, stepTarget('bake'));
    expect(g.next!.steps.find((s) => s.label === 'bake')!.row_start).toBe(1);
    const s = run('ArrowDown', alt, stepTarget('bake'));
    expect(s.next!.steps.find((s2) => s2.label === 'bake')!.row_start).toBe(3);
  });
  it('Alt+Shift+Up/Down moves the whole span', () => {
    const { next } = run('ArrowDown', { ...alt, ...shift }, stepTarget('mix'));
    const mix = next!.steps.find((s) => s.label === 'mix')!;
    expect([mix.row_start, mix.row_end]).toEqual([1, 4]);
  });
  it('limits are explained no-ops, never silent and never an action', () => {
    expect(run('ArrowDown', shift, stepTarget('bake')).r).toEqual({
      handled: true,
      noop: 'endAtLast',
    });
    expect(run('ArrowUp', alt, stepTarget('mix')).r).toEqual({
      handled: true,
      noop: 'startAtFirst',
    });
    expect(run('ArrowDown', { ...alt, ...shift }, stepTarget('bake')).r).toEqual({
      handled: true,
      noop: 'spanEdge',
    });
  });
  it('cannot shrink below one row', () => {
    const one = doc(reduce(state, { type: 'stepSetSpan', section: 0, step: 1, start: 2, end: 2 }))
      .sections[0];
    const tg = targetsFor(one).find((t) => t.kind === 'step' && t.key === one.steps[1].key)!;
    expect(stepChord(k('ArrowUp', shift), tg, one, 0)).toEqual({
      handled: true,
      noop: 'minOneRow',
    });
    expect(stepChord(k('ArrowDown', alt), tg, one, 0)).toEqual({
      handled: true,
      noop: 'minOneRow',
    });
  });
});

describe('step reorder and banner chords', () => {
  it('Alt+Right moves a step one column right and swallows the browser history shortcut', () => {
    const { r, next } = run('ArrowRight', alt, stepTarget('mix'));
    expect(r.handled).toBe(true);
    expect(next!.steps.filter((s) => s.kind === 'column').map((s) => s.label)).toEqual([
      'bake',
      'mix',
    ]);
  });
  it('Alt+Left at the first column is an explained no-op, still handled (preventDefault)', () => {
    expect(run('ArrowLeft', alt, stepTarget('mix')).r).toEqual({
      handled: true,
      noop: 'columnEdge',
    });
    expect(run('ArrowRight', alt, stepTarget('bake')).r).toEqual({
      handled: true,
      noop: 'columnEdge',
    });
  });
  it('Alt+Left/Right is swallowed over ingredient rows too (O4)', () => {
    const row = targets.find((t) => t.kind === 'row')!;
    expect(stepChord(k('ArrowLeft', alt), row, section, 0)).toEqual({ handled: true });
    expect(stepChord(k('ArrowUp', alt), row, section, 0)).toEqual({ handled: false });
  });
  it('Alt+Up/Down moves a banner inside its own group only', () => {
    const { next } = run('ArrowUp', alt, bannerTarget('b2'));
    expect(next!.steps.filter((s) => s.kind === 'banner_bottom').map((s) => s.label)).toEqual([
      'b2',
      'b1',
    ]);
    expect(run('ArrowUp', alt, bannerTarget('b1')).r).toEqual({
      handled: true,
      noop: 'bannerEdge',
    });
    expect(run('ArrowDown', alt, bannerTarget('t1')).r).toEqual({
      handled: true,
      noop: 'bannerEdge',
    });
  });
  it('ignores Ctrl/Meta chords and unrelated keys', () => {
    expect(
      stepChord(k('ArrowUp', { ...alt, ctrlKey: true }), stepTarget('mix'), section, 0),
    ).toEqual({
      handled: false,
    });
    expect(stepChord(k('a', alt), stepTarget('mix'), section, 0)).toEqual({ handled: false });
  });
});
