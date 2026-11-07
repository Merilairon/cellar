import { describe, expect, it } from 'vitest';
import { bottom, col, make, names, recipe, spansOf, top } from './fixtures';
import {
  canAddColumnStep,
  canAddRow,
  canAddSection,
  canDeleteSection,
  canRedo,
  canUndo,
  isDirty,
  reduce,
  run,
  type EditorAction,
} from './reducer';
import { LIMITS, doc, fromApiRecipe, toGridPayload } from './state';

const rows = (s: ReturnType<typeof make>, si = 0) => doc(s).sections[si].ingredients;
const steps = (s: ReturnType<typeof make>, si = 0) => doc(s).sections[si].steps;

describe('rows: move / add / delete (spans follow, Q1)', () => {
  it('rowMove reorders rows and spans follow the moved ingredients', () => {
    const s = reduce(make(4, [col(0, 1), col(2, 3)]), {
      type: 'rowMove',
      section: 0,
      from: 0,
      to: 3,
    });
    expect(names(s)).toEqual(['r1', 'r2', 'r3', 'r0']);
    expect(spansOf(s)).toEqual([
      [0, 3],
      [1, 2],
    ]);
  });
  it('rowMove moving a row inside a span keeps the span', () => {
    const s = reduce(make(5, [col(1, 3)]), { type: 'rowMove', section: 0, from: 1, to: 3 });
    expect(spansOf(s)).toEqual([[1, 3]]);
    expect(names(s)).toEqual(['r0', 'r2', 'r3', 'r1', 'r4']);
  });
  it('rowMove selects the moved row', () => {
    const s = reduce(make(3), { type: 'rowMove', section: 0, from: 0, to: 2 });
    expect(s.selection.rowKey).toBe('ing-0');
  });
  it('rowAdd appends with a deterministic key and an uncovered row', () => {
    const s = reduce(make(2, [col(0, 1)]), {
      type: 'rowAdd',
      section: 0,
      ingredient: { name: 'salt' },
    });
    expect(rows(s)[2]).toMatchObject({
      name: 'salt',
      key: expect.stringMatching(/^new-\d+$/),
      display_primary: 'metric',
    });
    expect(spansOf(s)).toEqual([[0, 1]]);
  });
  it('rowAdd inside a span is covered', () => {
    const s = reduce(make(4, [col(0, 3)]), { type: 'rowAdd', section: 0, at: 2 });
    expect(spansOf(s)).toEqual([[0, 4]]);
  });
  it('rowAdd at the start shifts spans', () => {
    const s = reduce(make(2, [col(0, 1)]), { type: 'rowAdd', section: 0, at: 0 });
    expect(spansOf(s)).toEqual([[1, 2]]);
  });
  it('rowAdd ignores a key or split group smuggled in the patch', () => {
    const s = reduce(make(1), {
      type: 'rowAdd',
      section: 0,
      ingredient: { name: 'x', ...({ key: 'evil', split_group: 'g' } as object) },
    });
    expect(rows(s)[1].key).not.toBe('evil');
    expect(rows(s)[1].split_group).toBeNull();
  });
  it('rowDelete shrinks spans and removes a span whose only row went, with a notice', () => {
    const base = make(4, [col(0, 0, 'melt'), col(0, 3)]);
    const s = reduce(base, { type: 'rowDelete', section: 0, row: 0 });
    expect(spansOf(s)).toEqual([[0, 2]]);
    expect(s.notice).toEqual({
      type: 'stepsRemoved',
      stepKeys: [steps(base)[0].key],
      labels: ['melt'],
    });
  });
  it('rowDelete of the last row removes every column step, banners stay', () => {
    const s = reduce(make(1, [top(), col(0, 0), bottom()]), {
      type: 'rowDelete',
      section: 0,
      row: 0,
    });
    expect(rows(s)).toHaveLength(0);
    expect(steps(s).map((t) => t.kind)).toEqual(['banner_top', 'banner_bottom']);
  });
  it('rowDelete of a portion clears the lone survivor group and label', () => {
    let s = reduce(make(1), { type: 'rowSplit', section: 0, row: 0 });
    s = reduce(s, { type: 'rowDelete', section: 0, row: 1 });
    expect(rows(s)[0]).toMatchObject({ split_group: null, portion_label: null });
  });
  it('undo restores a deleted row and the removed span together', () => {
    const base = make(2, [col(1, 1)]);
    const s = reduce(reduce(base, { type: 'rowDelete', section: 0, row: 1 }), { type: 'undo' });
    expect(doc(s)).toEqual(doc(base));
  });
});

describe('rowSplit (G7)', () => {
  const base = () =>
    reduce(make(3, [col(0, 0), col(0, 2), col(2, 2)]), {
      type: 'rowEditText',
      section: 0,
      row: 1,
      patch: { name: 'sugar', metric_qty: 100, metric_unit: 'g', us_qty: 3.5, us_unit: 'oz' },
    });
  it('inserts a row after, shares a fresh group, labels half/remaining', () => {
    const s = reduce(base(), { type: 'rowSplit', section: 0, row: 1 });
    expect(rows(s).map((r) => r.name)).toEqual(['r0', 'sugar', 'sugar', 'r2']);
    const [a, b] = [rows(s)[1], rows(s)[2]];
    expect(a.split_group).toBe(b.split_group);
    expect(a.split_group).toMatch(/^new-/);
    expect([a.portion_label, b.portion_label]).toEqual(['half', 'remaining']);
    expect(a.key).not.toBe(b.key);
  });
  it('halves the primary quantity on both rows and clears the derived side (C7)', () => {
    const s = reduce(base(), { type: 'rowSplit', section: 0, row: 1 });
    for (const r of [rows(s)[1], rows(s)[2]]) {
      expect(r).toMatchObject({ metric_qty: 50, metric_unit: 'g', us_qty: null, us_unit: null });
    }
  });
  it('halves ranges and works when us is primary', () => {
    let s = reduce(make(1), {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { display_primary: 'us', us_qty: 2, us_qty_max: 3, us_unit: 'tbsp' },
    });
    s = reduce(s, { type: 'rowSplit', section: 0, row: 0 });
    expect(rows(s)[0]).toMatchObject({ us_qty: 1, us_qty_max: 1.5 });
  });
  it('leaves a row without a quantity alone', () => {
    const s = reduce(make(1), { type: 'rowSplit', section: 0, row: 0 });
    expect(rows(s)[0].metric_qty).toBeNull();
    expect(rows(s)).toHaveLength(2);
  });
  it('covering steps cover both portions; steps after shift', () => {
    const s = reduce(base(), { type: 'rowSplit', section: 0, row: 1 });
    expect(spansOf(s)).toEqual([
      [0, 0],
      [0, 3],
      [3, 3],
    ]);
  });
  it('splitting a portion again keeps the group and its label', () => {
    let s = reduce(base(), { type: 'rowSplit', section: 0, row: 1 });
    s = reduce(s, { type: 'rowSplit', section: 0, row: 2 });
    const g = rows(s).filter((r) => r.split_group);
    expect(g).toHaveLength(3);
    expect(new Set(g.map((r) => r.split_group)).size).toBe(1);
    expect(new Set(rows(s).map((r) => r.key)).size).toBe(rows(s).length);
  });
  it('is refused at the 200-row cap', () => {
    const s = make(200);
    expect(reduce(s, { type: 'rowSplit', section: 0, row: 0 })).toBe(s);
  });
});

describe('rowEditText / rowEditField (C7, coalescing)', () => {
  const withQty = () =>
    reduce(make(1), {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { metric_qty: 115, metric_unit: 'g', us_qty: 4, us_unit: 'oz' },
    });
  it('a quantity change clears the stale derived side', () => {
    const s = reduce(
      reduce(withQty(), {
        type: 'rowEditText',
        section: 0,
        row: 0,
        patch: { us_qty: 4, us_unit: 'oz' },
      }),
      { type: 'rowEditText', section: 0, row: 0, patch: { metric_qty: 120 } },
    );
    expect(rows(s)[0]).toMatchObject({
      metric_qty: 120,
      us_qty: null,
      us_unit: null,
      us_qty_max: null,
    });
  });
  it('a unit change clears the other side too', () => {
    const s = reduce(
      reduce(withQty(), {
        type: 'rowEditText',
        section: 0,
        row: 0,
        patch: { us_qty: 4, us_unit: 'oz' },
      }),
      { type: 'rowEditText', section: 0, row: 0, patch: { metric_unit: 'ml' } },
    );
    expect(rows(s)[0].us_qty).toBeNull();
  });
  it('a name-only change keeps the derived side', () => {
    const base = reduce(withQty(), {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { us_qty: 4, us_unit: 'oz' },
    });
    const s = reduce(base, { type: 'rowEditText', section: 0, row: 0, patch: { name: 'butter' } });
    expect(rows(s)[0]).toMatchObject({ name: 'butter', us_qty: 4, us_unit: 'oz' });
  });
  it('a parsed dual-unit line (both sides supplied) keeps both', () => {
    const s = reduce(make(1), {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { metric_qty: 115, metric_unit: 'g', us_qty: 4, us_unit: 'oz' },
    });
    expect(rows(s)[0]).toMatchObject({ metric_qty: 115, us_qty: 4 });
  });
  it('an edit that does not change anything returns the same state', () => {
    const s = make(1);
    expect(reduce(s, { type: 'rowEditText', section: 0, row: 0, patch: { name: 'r0' } })).toBe(s);
  });
  it('switching display_primary clears the new non-primary side', () => {
    const s = reduce(withQty(), {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { display_primary: 'us' },
    });
    expect(rows(s)[0]).toMatchObject({ metric_qty: null, metric_unit: null });
  });
  it('ten edits with the same groupKey are one undo step', () => {
    let s = make(1);
    for (let i = 1; i <= 10; i++) {
      s = reduce(s, {
        type: 'rowEditText',
        section: 0,
        row: 0,
        patch: { name: 'x'.repeat(i) },
        groupKey: 'r0:name',
      });
    }
    expect(s.history.past).toHaveLength(1);
    expect(names(reduce(s, { type: 'undo' }))).toEqual(['r0']);
  });
  it('a different row or field starts a new undo step', () => {
    let s = make(2);
    s = reduce(s, {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { name: 'a' },
      groupKey: 'r0:name',
    });
    s = reduce(s, {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { name: 'ab' },
      groupKey: 'r0:name',
    });
    s = reduce(s, {
      type: 'rowEditText',
      section: 0,
      row: 1,
      patch: { name: 'b' },
      groupKey: 'r1:name',
    });
    s = reduce(s, {
      type: 'rowEditField',
      section: 0,
      row: 1,
      field: 'group_label',
      value: 'For sauce',
      groupKey: 'r1:group',
    });
    expect(s.history.past).toHaveLength(3);
  });
  it('rowEditField edits portion_label, blank becomes null', () => {
    let s = reduce(make(1), {
      type: 'rowEditField',
      section: 0,
      row: 0,
      field: 'portion_label',
      value: 'half',
    });
    expect(rows(s)[0].portion_label).toBe('half');
    s = reduce(s, {
      type: 'rowEditField',
      section: 0,
      row: 0,
      field: 'portion_label',
      value: '  ',
    });
    expect(rows(s)[0].portion_label).toBeNull();
  });
  it('rowEditField rejects unknown fields', () => {
    const s = make(1);
    expect(
      reduce(s, { type: 'rowEditField', section: 0, row: 0, field: 'name' as never, value: 'x' }),
    ).toBe(s);
  });
});

describe('steps (G8, G9)', () => {
  it('stepAdd defaults to the first uncovered row, appended among columns before bottom banners', () => {
    const s = reduce(make(3, [top(), col(0, 0), bottom()]), {
      type: 'stepAdd',
      section: 0,
      step: { label: 'mix' },
    });
    expect(steps(s).map((t) => t.kind)).toEqual([
      'banner_top',
      'column',
      'column',
      'banner_bottom',
    ]);
    expect(spansOf(s)[2]).toEqual([1, 1]);
  });
  it('stepAdd with every row covered spans all rows', () => {
    const s = reduce(make(3, [col(0, 2)]), { type: 'stepAdd', section: 0 });
    expect(spansOf(s)[1]).toEqual([0, 2]);
  });
  it('stepAdd honours the index among columns', () => {
    const s = reduce(make(3, [col(0, 0, 'a'), col(1, 1, 'b')]), {
      type: 'stepAdd',
      section: 0,
      at: 0,
      step: { label: 'new' },
    });
    expect(steps(s).map((t) => t.label)).toEqual(['new', 'a', 'b']);
  });
  it('stepAdd on a section without rows is refused', () => {
    const s = make(0);
    expect(reduce(s, { type: 'stepAdd', section: 0 })).toBe(s);
    expect(canAddColumnStep(s, 0)).toBe(false);
  });
  it('bannerAdd puts top banners before columns and bottom banners last', () => {
    let s = make(2, [col(0, 1)]);
    s = reduce(s, {
      type: 'bannerAdd',
      section: 0,
      kind: 'banner_bottom',
      step: { label: 'serve' },
    });
    s = reduce(s, { type: 'bannerAdd', section: 0, kind: 'banner_top', step: { label: 'heat' } });
    s = reduce(s, { type: 'bannerAdd', section: 0, kind: 'banner_top', step: { label: 'grease' } });
    expect(steps(s).map((t) => t.label)).toEqual(['heat', 'grease', 'c0-1', 'serve']);
    expect(steps(s)[0]).toMatchObject({ row_start: null, row_end: null });
  });
  it('stepDelete removes a step', () => {
    const s = reduce(make(2, [col(0, 0), col(1, 1)]), { type: 'stepDelete', section: 0, step: 0 });
    expect(spansOf(s)).toEqual([[1, 1]]);
  });
  it('stepMove reorders within a kind only', () => {
    const base = make(3, [top('t1'), top('t2'), col(0, 0, 'a'), col(1, 1, 'b'), bottom('z')]);
    expect(
      steps(reduce(base, { type: 'stepMove', section: 0, step: 3, to: 2 })).map((t) => t.label),
    ).toEqual(['t1', 't2', 'b', 'a', 'z']);
    expect(
      steps(reduce(base, { type: 'stepMove', section: 0, step: 0, to: 1 })).map((t) => t.label),
    ).toEqual(['t2', 't1', 'a', 'b', 'z']);
    expect(reduce(base, { type: 'stepMove', section: 0, step: 1, to: 2 })).toBe(base);
    expect(reduce(base, { type: 'stepMove', section: 0, step: 4, to: 3 })).toBe(base);
  });
  it('stepMove does not change the span', () => {
    const s = reduce(make(3, [col(0, 0), col(1, 2)]), {
      type: 'stepMove',
      section: 0,
      step: 1,
      to: 0,
    });
    expect(spansOf(s)).toEqual([
      [1, 2],
      [0, 0],
    ]);
  });
  it('stepSetSpan clamps; grow/shrink move one edge and stop at the limits', () => {
    const base = make(5, [col(1, 3)]);
    expect(
      spansOf(reduce(base, { type: 'stepSetSpan', section: 0, step: 0, start: -4, end: 99 })),
    ).toEqual([[0, 4]]);
    expect(spansOf(reduce(base, { type: 'stepGrowStart', section: 0, step: 0 }))).toEqual([[0, 3]]);
    expect(spansOf(reduce(base, { type: 'stepShrinkStart', section: 0, step: 0 }))).toEqual([
      [2, 3],
    ]);
    expect(spansOf(reduce(base, { type: 'stepGrowEnd', section: 0, step: 0 }))).toEqual([[1, 4]]);
    expect(spansOf(reduce(base, { type: 'stepShrinkEnd', section: 0, step: 0 }))).toEqual([[1, 2]]);
    const one = make(5, [col(0, 0)]);
    expect(reduce(one, { type: 'stepShrinkStart', section: 0, step: 0 })).toBe(one);
    expect(reduce(one, { type: 'stepShrinkEnd', section: 0, step: 0 })).toBe(one);
    expect(reduce(one, { type: 'stepGrowStart', section: 0, step: 0 })).toBe(one);
    const full = make(5, [col(0, 4)]);
    expect(reduce(full, { type: 'stepGrowEnd', section: 0, step: 0 })).toBe(full);
  });
  it('stepSetSpan on a banner is refused', () => {
    const s = make(3, [top()]);
    expect(reduce(s, { type: 'stepSetSpan', section: 0, step: 0, start: 0, end: 1 })).toBe(s);
  });
  it('stepConvert column -> banner defaults to bottom when the span ends at the last row', () => {
    const s = reduce(make(3, [col(0, 0), col(1, 2, 'finish')]), {
      type: 'stepConvert',
      section: 0,
      step: 1,
    });
    expect(steps(s)[1]).toMatchObject({
      kind: 'banner_bottom',
      label: 'finish',
      row_start: null,
      row_end: null,
    });
  });
  it('stepConvert column -> banner defaults to top otherwise and honours an explicit target', () => {
    const base = make(3, [col(0, 1, 'x'), col(2, 2, 'y')]);
    expect(steps(reduce(base, { type: 'stepConvert', section: 0, step: 0 }))[0].kind).toBe(
      'banner_top',
    );
    expect(
      steps(reduce(base, { type: 'stepConvert', section: 0, step: 0, to: 'banner_bottom' }))[1]
        .kind,
    ).toBe('banner_bottom');
  });
  it('stepConvert keeps detail, temperature and time', () => {
    const base = reduce(make(2, [col(0, 0)]), {
      type: 'stepEdit',
      section: 0,
      step: 0,
      patch: { detail: 'hot', temp_c: 180, minutes_min: 5, minutes_max: 8 },
    });
    expect(steps(reduce(base, { type: 'stepConvert', section: 0, step: 0 }))[0]).toMatchObject({
      detail: 'hot',
      temp_c: 180,
      minutes_min: 5,
      minutes_max: 8,
    });
  });
  it('stepConvert banner -> column becomes the last column over the first uncovered row', () => {
    const s = reduce(make(3, [top('p'), col(0, 1), bottom()]), {
      type: 'stepConvert',
      section: 0,
      step: 0,
    });
    expect(steps(s).map((t) => t.kind)).toEqual(['column', 'column', 'banner_bottom']);
    expect(spansOf(s)).toEqual([[0, 1], [2, 2], null]);
  });
  it('stepConvert banner -> column with all rows covered spans all rows', () => {
    const s = reduce(make(3, [top(), col(0, 2)]), { type: 'stepConvert', section: 0, step: 0 });
    expect(spansOf(s)[1]).toEqual([0, 2]);
  });
  it('stepConvert top <-> bottom moves between banner groups', () => {
    const s = reduce(make(1, [top('t'), col(0, 0)]), {
      type: 'stepConvert',
      section: 0,
      step: 0,
      to: 'banner_bottom',
    });
    expect(steps(s).map((t) => t.kind)).toEqual(['column', 'banner_bottom']);
  });
  it('stepConvert to the same kind is a no-op; banner -> column with no rows is refused', () => {
    const a = make(1, [top()]);
    expect(reduce(a, { type: 'stepConvert', section: 0, step: 0, to: 'banner_top' })).toBe(a);
    const b = make(0, [top()]);
    expect(reduce(b, { type: 'stepConvert', section: 0, step: 0 })).toBe(b);
  });
  it('stepEdit coalesces by groupKey', () => {
    let s = make(1, [col(0, 0)]);
    for (const l of ['m', 'mi', 'mix']) {
      s = reduce(s, {
        type: 'stepEdit',
        section: 0,
        step: 0,
        patch: { label: l },
        groupKey: 'st:label',
      });
    }
    expect(s.history.past).toHaveLength(1);
    expect(steps(s)[0].label).toBe('mix');
  });
  it('stepAdd is refused at the 100-step cap', () => {
    const s = make(
      2,
      Array.from({ length: LIMITS.steps }, () => top()),
    );
    expect(reduce(s, { type: 'stepAdd', section: 0 })).toBe(s);
    expect(reduce(s, { type: 'bannerAdd', section: 0, kind: 'banner_top' })).toBe(s);
  });
});

describe('sections (O2 defaults, caps)', () => {
  it('sectionAdd creates an empty section with no title, rows or steps', () => {
    const s = reduce(make(2), { type: 'sectionAdd' });
    expect(doc(s).sections).toHaveLength(2);
    expect(doc(s).sections[1]).toMatchObject({ title: null, ingredients: [], steps: [] });
  });
  it('sectionAdd with a title and at index', () => {
    const s = reduce(make(1), { type: 'sectionAdd', at: 0, title: ' Frosting ' });
    expect(doc(s).sections[0].title).toBe(' Frosting ');
    expect(doc(s).sections[1].key).toBe('sec-1');
  });
  it('sectionAdd is refused at 20 sections', () => {
    let s = make(1);
    for (let i = 1; i < LIMITS.sections; i++) s = reduce(s, { type: 'sectionAdd' });
    expect(doc(s).sections).toHaveLength(20);
    expect(canAddSection(s)).toBe(false);
    expect(reduce(s, { type: 'sectionAdd' })).toBe(s);
  });
  it('deleting the only section is refused', () => {
    const s = make(1);
    expect(canDeleteSection(s)).toBe(false);
    expect(reduce(s, { type: 'sectionDelete', section: 0 })).toBe(s);
  });
  it('sectionDelete removes one of several; undo brings it back', () => {
    const two = reduce(make(1), { type: 'sectionAdd', title: 'B' });
    const del = reduce(two, { type: 'sectionDelete', section: 0 });
    expect(doc(del).sections.map((x) => x.title)).toEqual(['B']);
    expect(doc(reduce(del, { type: 'undo' }))).toBe(doc(two));
  });
  it('sectionRename sets, blanks to null, and coalesces', () => {
    let s = make(1);
    s = reduce(s, { type: 'sectionRename', section: 0, title: 'C', groupKey: 'sec:title' });
    s = reduce(s, { type: 'sectionRename', section: 0, title: 'Ca', groupKey: 'sec:title' });
    expect(s.history.past).toHaveLength(1);
    expect(
      doc(reduce(s, { type: 'sectionRename', section: 0, title: ' ' })).sections[0].title,
    ).toBeNull();
  });
  it('sectionMove reorders sections', () => {
    let s = reduce(make(1), { type: 'sectionAdd', title: 'B' });
    s = reduce(s, { type: 'sectionMove', section: 1, to: 0 });
    expect(doc(s).sections.map((x) => x.title)).toEqual(['B', null]);
  });
  it('rows are refused at the 200-row cap', () => {
    const s = make(LIMITS.ingredients);
    expect(canAddRow(s, 0)).toBe(false);
    expect(reduce(s, { type: 'rowAdd', section: 0 })).toBe(s);
  });
});

describe('undo / redo / saved / reset / selection', () => {
  it('undo then redo returns an identical state document', () => {
    const s = run(make(3, [col(0, 2)]), [
      { type: 'rowMove', section: 0, from: 0, to: 2 },
      { type: 'rowSplit', section: 0, row: 1 },
    ]);
    const u = reduce(s, { type: 'undo' });
    expect(doc(reduce(u, { type: 'redo' }))).toBe(doc(s));
  });
  it('undo of N actions returns the original document (deep equal)', () => {
    const base = make(4, [top(), col(0, 1), col(2, 3), bottom()]);
    const actions: EditorAction[] = [
      { type: 'rowMove', section: 0, from: 3, to: 0 },
      { type: 'rowDelete', section: 0, row: 1 },
      { type: 'rowSplit', section: 0, row: 0 },
      { type: 'stepAdd', section: 0 },
      { type: 'stepConvert', section: 0, step: 1 },
      { type: 'sectionAdd' },
      { type: 'rowAdd', section: 1, ingredient: { name: 'z' } },
    ];
    let s = run(base, actions);
    expect(canUndo(s)).toBe(true);
    for (let i = 0; i < actions.length; i++) s = reduce(s, { type: 'undo' });
    expect(doc(s)).toEqual(doc(base));
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(true);
  });
  it('a new action after undo drops the redo stack', () => {
    let s = reduce(make(2), { type: 'rowMove', section: 0, from: 0, to: 1 });
    s = reduce(s, { type: 'undo' });
    s = reduce(s, { type: 'rowAdd', section: 0 });
    expect(canRedo(s)).toBe(false);
  });
  it('undo with nothing to undo returns the same state', () => {
    const s = make(1);
    expect(reduce(s, { type: 'undo' })).toBe(s);
    expect(reduce(s, { type: 'redo' })).toBe(s);
  });
  it('keys are never reused after undo (counter is outside history)', () => {
    let s = reduce(make(1), { type: 'rowAdd', section: 0 });
    const k1 = rows(s)[1].key;
    s = reduce(reduce(s, { type: 'undo' }), { type: 'rowAdd', section: 0 });
    expect(rows(s)[1].key).not.toBe(k1);
  });
  it('dirty tracks "differs from last save"; history survives markSaved (Q9)', () => {
    let s = make(2);
    expect(isDirty(s)).toBe(false);
    s = reduce(s, { type: 'rowMove', section: 0, from: 0, to: 1 });
    expect(isDirty(s)).toBe(true);
    s = reduce(s, { type: 'markSaved' });
    expect(isDirty(s)).toBe(false);
    expect(canUndo(s)).toBe(true);
    s = reduce(s, { type: 'undo' });
    expect(isDirty(s)).toBe(true);
  });
  it('reset rebuilds the state from a recipe', () => {
    const s = reduce(reduce(make(1), { type: 'rowAdd', section: 0 }), {
      type: 'reset',
      recipe: recipe(3),
    });
    expect(rows(s)).toHaveLength(3);
    expect(canUndo(s)).toBe(false);
  });
  it('select ignores unknown keys; undo clears a selection that vanished', () => {
    let s = make(1);
    expect(reduce(s, { type: 'select', rowKey: 'nope' })).toBe(s);
    s = reduce(s, { type: 'rowAdd', section: 0 });
    const k = s.selection.rowKey!;
    expect(k).toBeTruthy();
    s = reduce(s, { type: 'undo' });
    expect(s.selection.rowKey).toBeNull();
    s = reduce(s, { type: 'select', rowKey: 'ing-0' });
    expect(s.selection.rowKey).toBe('ing-0');
  });
  it('the selection is not part of history', () => {
    let s = reduce(make(2), { type: 'rowMove', section: 0, from: 0, to: 1 });
    const past = s.history.past.length;
    s = reduce(s, { type: 'select', rowKey: 'ing-1' });
    expect(s.history.past).toHaveLength(past);
  });
});

describe('totality: never throws, bad indices are a no-op with the same reference', () => {
  const bad = [-1, 99, 1.5, Number.NaN];
  const mk = () => make(3, [top(), col(0, 1), bottom()]);
  it('every indexed action on bad indices', () => {
    const s = mk();
    for (const i of bad) {
      const actions: EditorAction[] = [
        { type: 'rowMove', section: 0, from: i, to: 0 },
        { type: 'rowMove', section: 0, from: 0, to: i },
        { type: 'rowMove', section: i, from: 0, to: 1 },
        { type: 'rowAdd', section: i },
        { type: 'rowAdd', section: 0, at: i },
        { type: 'rowDelete', section: 0, row: i },
        { type: 'rowSplit', section: 0, row: i },
        { type: 'rowEditText', section: 0, row: i, patch: { name: 'x' } },
        { type: 'rowEditField', section: 0, row: i, field: 'portion_label', value: 'x' },
        { type: 'stepAdd', section: i },
        { type: 'stepAdd', section: 0, at: i },
        { type: 'bannerAdd', section: i, kind: 'banner_top' },
        { type: 'stepDelete', section: 0, step: i },
        { type: 'stepMove', section: 0, step: i, to: 1 },
        { type: 'stepSetSpan', section: 0, step: i, start: 0, end: 1 },
        { type: 'stepGrowEnd', section: 0, step: i },
        { type: 'stepConvert', section: 0, step: i },
        { type: 'stepEdit', section: 0, step: i, patch: { label: 'x' } },
        { type: 'sectionAdd', at: i },
        { type: 'sectionRename', section: i, title: 'x' },
        { type: 'sectionDelete', section: i },
        { type: 'sectionMove', section: i, to: 0 },
      ];
      for (const a of actions) expect(reduce(s, a), JSON.stringify(a)).toBe(s);
    }
  });
  it('a size x index sweep never throws and keeps the payload free of grid errors', () => {
    for (let n = 0; n <= 4; n++) {
      for (let i = -1; i <= n; i++) {
        for (let j = -1; j <= n; j++) {
          const s0 = make(n, n ? [top(), col(0, n - 1), bottom()] : [top()]);
          const actions: EditorAction[] = [
            { type: 'rowMove', section: 0, from: i, to: j },
            { type: 'rowDelete', section: 0, row: i },
            { type: 'rowSplit', section: 0, row: i },
            { type: 'rowAdd', section: 0, at: i },
            { type: 'stepSetSpan', section: 0, step: 1, start: i, end: j },
            { type: 'stepConvert', section: 0, step: i },
          ];
          for (const a of actions) {
            const out = reduce(s0, a);
            expect(
              toGridPayload(out, 'x').sections[0].steps.every(
                (t) =>
                  t.kind !== 'column' ||
                  (t.row_start! >= 0 && t.row_end! < Math.max(rows(out).length, 1)),
              ),
              JSON.stringify([n, a]),
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe('deterministic sequences keep the grid valid', () => {
  it('a fixed pseudo-random walk (LCG, seed 7) never produces a validator error; undo unwinds it', async () => {
    const { validateRecipeGrid } = await import('../validate');
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const base = make(5, [top(), col(0, 0), col(0, 2), col(0, 4), bottom()]);
    let s = base;
    let applied = 0;
    for (let k = 0; k < 90; k++) {
      const sec = 0;
      const n = rows(s, sec).length;
      const m = steps(s, sec).length;
      const choices: EditorAction[] =
        n < 3
          ? [{ type: 'rowAdd', section: sec, ingredient: { name: `n${k}` } }]
          : [
              { type: 'rowMove', section: sec, from: rnd(n || 1), to: rnd(n || 1) },
              { type: 'rowAdd', section: sec, at: rnd(n + 1), ingredient: { name: `n${k}` } },
              { type: 'rowDelete', section: sec, row: rnd(n || 1) },
              { type: 'rowSplit', section: sec, row: rnd(n || 1) },
              { type: 'stepAdd', section: sec, step: { label: `s${k}` } },
              { type: 'stepDelete', section: sec, step: rnd(m || 1) },
              { type: 'stepGrowEnd', section: sec, step: rnd(m || 1) },
              { type: 'stepShrinkStart', section: sec, step: rnd(m || 1) },
              { type: 'stepConvert', section: sec, step: rnd(m || 1) },
              { type: 'stepMove', section: sec, step: rnd(m || 1), to: rnd(m || 1) },
            ];
      const next = reduce(s, choices[rnd(choices.length)]);
      if (next !== s) applied++;
      s = next;
      expect(validateRecipeGrid(toGridPayload(s, 'x')).errors, `step ${k}`).toEqual([]);
    }
    expect(applied).toBeGreaterThan(40);
    const end = s;
    let u = s;
    while (canUndo(u)) u = reduce(u, { type: 'undo' });
    expect(doc(u)).toEqual(doc(base));
    while (canRedo(u)) u = reduce(u, { type: 'redo' });
    expect(doc(u)).toBe(doc(end));
  });
});

describe('fromApiRecipe keys (G4)', () => {
  it('uses server ids as keys and new-<n> for items without one; steps are canonical order', () => {
    const r = recipe(1, [bottom('b'), col(0, 0), top('t')]);
    r.sections[0].id = null;
    const s = fromApiRecipe(r);
    expect(doc(s).sections[0].key).toBe('new-1');
    expect(doc(s).sections[0].ingredients[0].key).toBe('ing-0');
    expect(steps(s).map((t) => t.kind)).toEqual(['banner_top', 'column', 'banner_bottom']);
    expect(s.nextKey).toBeGreaterThan(4);
  });
});
