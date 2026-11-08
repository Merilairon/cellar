import { describe, expect, it } from 'vitest';
import { doc, isDirty } from '@/lib/grid/editor';
import { col, recipe } from '@/lib/grid/editor/fixtures';
import { initSession, reduceSession, type Session } from './session';

const start = (rows = 3, steps = [col(0, 0, 'Mix')]) => initSession(recipe(rows, steps));
const run = (s: Session, ...a: Parameters<typeof reduceSession>[1][]) => a.reduce(reduceSession, s);
const ids = (s: Session) => s.announcement?.parts.map((p) => p.id);

describe('session: label stack mirrors history', () => {
  it('records one label per history entry and keeps stacks aligned through undo/redo', () => {
    let s = run(
      start(),
      { type: 'rowMove', section: 0, from: 0, to: 1 },
      { type: 'stepSetSpan', section: 0, step: 0, start: 0, end: 1 },
    );
    expect(s.labels.past).toEqual(['rowMove', 'stepResize']);
    expect(s.labels.past.length).toBe(s.editor.history.past.length);
    s = run(s, { type: 'undo' });
    expect(s.labels).toEqual({ past: ['rowMove'], future: ['stepResize'] });
    expect(ids(s)).toContain('undone');
    s = run(s, { type: 'redo' });
    expect(s.labels).toEqual({ past: ['rowMove', 'stepResize'], future: [] });
    expect(ids(s)).toContain('redone');
  });

  it('a new action clears the redo labels', () => {
    let s = run(start(), { type: 'rowAdd', section: 0 }, { type: 'undo' });
    expect(s.labels.future).toEqual(['rowAdd']);
    s = run(s, { type: 'rowAdd', section: 0 });
    expect(s.labels.future).toEqual([]);
  });

  it('coalesced edits stay one entry and one label', () => {
    const s = run(
      start(),
      { type: 'stepEdit', section: 0, step: 0, patch: { label: 'M' }, groupKey: 'k' },
      { type: 'stepEdit', section: 0, step: 0, patch: { label: 'Mi' }, groupKey: 'k' },
    );
    expect(s.editor.history.past.length).toBe(1);
    expect(s.labels.past).toEqual(['stepEdit']);
  });

  it('selection and no-ops do not touch history, labels or announcements', () => {
    const s0 = start();
    const s1 = run(s0, { type: 'select', stepKey: doc(s0.editor).sections[0].steps[0].key });
    expect(s1.labels).toEqual(s0.labels);
    expect(s1.announcement).toBeNull();
    expect(isDirty(s1.editor)).toBe(false);
    expect(run(s0, { type: 'rowMove', section: 0, from: 1, to: 1 })).toBe(s0);
  });

  it('undo and redo with nothing to do announce that, once', () => {
    const s = run(start(), { type: 'undo' });
    expect(s.announcement?.parts).toEqual([{ id: 'nothingToUndo' }]);
    expect(s.editor).toBe(start().editor.history ? s.editor : s.editor);
    const r = run(s, { type: 'redo' });
    expect(r.announcement?.parts).toEqual([{ id: 'nothingToRedo' }]);
    expect(r.announcement!.seq).toBeGreaterThan(s.announcement!.seq);
  });

  it('markSaved clears dirty, keeps history, and sets saved', () => {
    const edited = run(start(), { type: 'rowAdd', section: 0 });
    const s = run(edited, { type: 'markSaved', doc: doc(edited.editor) });
    expect(isDirty(s.editor)).toBe(false);
    expect(s.saved).toBe(true);
    expect(s.labels.past).toEqual(['rowAdd']);
  });

  it('reset starts a fresh session', () => {
    const s = run(start(), { type: 'rowAdd', section: 0 }, { type: 'reset', recipe: recipe(2) });
    expect(s.labels).toEqual({ past: [], future: [] });
    expect(doc(s.editor).sections[0].ingredients).toHaveLength(2);
  });
});

describe('session: uncovered transitions', () => {
  it('announces when a change leaves rows uncovered, and when all are covered again', () => {
    let s = start(3, [col(0, 2, 'Mix')]);
    expect(s.announcement).toBeNull(); // initial warnings are not announced
    s = run(s, { type: 'stepShrinkEnd', section: 0, step: 0 });
    expect(s.announcement?.parts).toEqual([{ id: 'uncoveredNow', names: 'r2' }]);
    s = run(s, { type: 'stepGrowEnd', section: 0, step: 0 });
    expect(s.announcement?.parts).toEqual([{ id: 'allCovered' }]);
  });

  it('does not announce when the uncovered set is unchanged', () => {
    const s0 = start(3, [col(0, 0, 'Mix')]);
    const s = run(s0, { type: 'stepEdit', section: 0, step: 0, patch: { label: 'Stir' } });
    expect(s.announcement).toBeNull();
    expect(s.seq).toBe(s0.seq);
  });

  it('undo reports the action and the coverage change together, as one announcement', () => {
    let s = run(start(3, [col(0, 2, 'Mix')]), { type: 'stepShrinkEnd', section: 0, step: 0 });
    s = run(s, { type: 'undo' });
    expect(s.announcement?.parts).toEqual([
      { id: 'undone', action: 'stepResize' },
      { id: 'allCovered' },
    ]);
  });

  it('caps the listed names', () => {
    const s = run(start(6, [col(0, 5, 'Mix')]), {
      type: 'stepSetSpan',
      section: 0,
      step: 0,
      start: 5,
      end: 5,
    });
    expect(s.announcement?.parts).toEqual([{ id: 'uncoveredNow', names: 'r0, r1, r2 +2' }]);
  });
});
