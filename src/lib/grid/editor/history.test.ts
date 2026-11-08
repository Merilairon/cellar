import { describe, expect, it } from 'vitest';
import {
  HISTORY_CAP,
  canRedo,
  canUndo,
  commit,
  createHistory,
  isDirty,
  markSaved,
  redo,
  undo,
} from './history';

describe('history', () => {
  it('starts clean with nothing to undo or redo', () => {
    const h = createHistory({ n: 0 });
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(isDirty(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('commit pushes, undo/redo walk and a new commit clears the future', () => {
    let h = createHistory(0);
    h = commit(h, 1);
    h = commit(h, 2);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(2);
    h = undo(undo(h));
    h = commit(h, 9);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(9);
  });

  it('committing the identical snapshot is a no-op (same reference)', () => {
    const v = { a: 1 };
    const h = createHistory(v);
    expect(commit(h, v)).toBe(h);
  });

  it('coalesces consecutive commits with the same group key into one entry', () => {
    let h = createHistory('');
    for (const t of ['a', 'ab', 'abc']) h = commit(h, t, 'row1:name');
    expect(h.past).toEqual(['']);
    expect(undo(h).present).toBe('');
  });

  it('a different group key, or none, starts a new entry', () => {
    let h = createHistory('');
    h = commit(h, 'a', 'k1');
    h = commit(h, 'ab', 'k2');
    h = commit(h, 'abc');
    h = commit(h, 'abcd');
    expect(h.past).toEqual(['', 'a', 'ab', 'abc']);
  });

  it('undo/redo end a coalescing run', () => {
    let h = commit(createHistory(''), 'a', 'k');
    h = redo(undo(h));
    h = commit(h, 'ab', 'k');
    expect(h.past).toEqual(['', 'a']);
  });

  it('caps the past at HISTORY_CAP, dropping the oldest', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_CAP + 20; i++) h = commit(h, i);
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]).toBe(20);
  });

  it('dirty is identity against the saved snapshot, including after undo back to it', () => {
    let h = createHistory({ v: 1 });
    h = commit(h, { v: 2 });
    expect(isDirty(h)).toBe(true);
    h = markSaved(h);
    expect(isDirty(h)).toBe(false);
    h = commit(h, { v: 3 });
    expect(isDirty(h)).toBe(true);
    h = undo(h);
    expect(isDirty(h)).toBe(false);
    h = undo(h);
    expect(isDirty(h)).toBe(true);
  });

  it('typing after a save starts a new entry even with the same group key', () => {
    let h = commit(createHistory(''), 'a', 'k');
    h = markSaved(h);
    h = commit(h, 'ab', 'k');
    expect(h.past).toEqual(['', 'a']);
    expect(isDirty(h)).toBe(true);
    expect(undo(h).present).toBe('a');
    expect(isDirty(undo(h))).toBe(false);
  });
});
