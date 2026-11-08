import { describe, expect, it } from 'vitest';
import { col, make, top } from './fixtures';
import { issuesFor, mapServerErrors, parseIssuePath, resolveIssueTarget } from './issues';
import { reduce } from './reducer';
import { doc } from './state';

describe('parseIssuePath (G2)', () => {
  it.each([
    ['sections.0', { section: 0, kind: 'section' }],
    ['sections.2.title', { section: 2, kind: 'section', field: 'title' }],
    ['sections.0.steps.1.row_end', { section: 0, kind: 'step', index: 1, field: 'row_end' }],
    ['sections.1.ingredients.4', { section: 1, kind: 'ingredient', index: 4 }],
    [
      'sections.1.ingredients.4.position',
      { section: 1, kind: 'ingredient', index: 4, field: 'position' },
    ],
    [
      'sections.0.ingredients.3.split_group_id',
      { section: 0, kind: 'ingredient', index: 3, field: 'split_group_id' },
    ],
  ])('%s', (path, expected) => {
    expect(parseIssuePath(path)).toEqual(expected);
  });
  it.each([
    '',
    'sections',
    'base_updated_at',
    'sections.x',
    'sections.0.steps',
    'sections.0.foo.1',
    'tags.0',
  ])('rejects %j', (path) => expect(parseIssuePath(path)).toBeNull());
});

describe('resolveIssueTarget / mapServerErrors', () => {
  const s = make(3, [top(), col(0, 1)]);
  const d = doc(s);
  it('resolves to client keys', () => {
    expect(resolveIssueTarget(d, 'sections.0.steps.1.row_end')).toEqual({
      sectionKey: 'sec-1',
      stepKey: d.sections[0].steps[1].key,
      field: 'row_end',
    });
    expect(resolveIssueTarget(d, 'sections.0.ingredients.2')).toEqual({
      sectionKey: 'sec-1',
      rowKey: 'ing-2',
    });
  });
  it('returns null out of range or unparseable', () => {
    expect(resolveIssueTarget(d, 'sections.5.ingredients.0')).toBeNull();
    expect(resolveIssueTarget(d, 'sections.0.ingredients.9')).toBeNull();
    expect(resolveIssueTarget(d, 'base_updated_at')).toBeNull();
  });
  it('maps server 422 errors incl. the banner invalid_type paths and the strict-body error', () => {
    const out = mapServerErrors(d, [
      { path: 'sections.0.steps.0.row_start', code: 'invalid_type' },
      { path: 'sections.0.steps.1.row_order', code: 'x' },
      { path: '', code: 'unrecognized_keys' },
      { path: 'base_updated_at', code: 'invalid_timestamp' },
    ]);
    expect(out[0].target).toMatchObject({
      stepKey: d.sections[0].steps[0].key,
      field: 'row_start',
    });
    expect(out[1].target).toMatchObject({ stepKey: d.sections[0].steps[1].key });
    expect(out[2].target).toBeNull();
    expect(out[3].target).toBeNull();
  });
});

describe('issuesFor', () => {
  it('a valid grid has no errors; an uncovered row is a warning with a row target', () => {
    const r = issuesFor(make(3, [col(0, 1)]));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      {
        path: 'sections.0.ingredients.2',
        code: 'row_uncovered',
        target: { sectionKey: 'sec-1', rowKey: 'ing-2' },
      },
    ]);
  });
  it('rows without any column step produce no uncovered warnings', () => {
    expect(issuesFor(make(3, [top()])).warnings).toEqual([]);
  });
  it('an empty section is a warning (O2), not an error', () => {
    const r = issuesFor(reduce(make(1), { type: 'sectionAdd' }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('section_empty');
  });
  it('empty banner label is banner_empty; empty column label is label_empty; empty name is name_empty', () => {
    let s = make(1);
    s = reduce(s, { type: 'bannerAdd', section: 0, kind: 'banner_top' });
    s = reduce(s, { type: 'stepAdd', section: 0 });
    s = reduce(s, { type: 'rowAdd', section: 0 });
    const codes = issuesFor(s).errors.map((e) => [e.path, e.code]);
    expect(codes).toContainEqual(['sections.0.steps.0.label', 'banner_empty']);
    expect(codes).toContainEqual(['sections.0.steps.1.label', 'label_empty']);
    expect(codes).toContainEqual(['sections.0.ingredients.1.name', 'name_empty']);
    expect(codes).toHaveLength(3);
  });
  it('whitespace-only text counts as empty', () => {
    const s = reduce(make(1), { type: 'rowEditText', section: 0, row: 0, patch: { name: '   ' } });
    expect(issuesFor(s).errors.map((e) => e.code)).toEqual(['name_empty']);
  });
  it('schema-only rules surface: range order and minutes order', () => {
    let s = reduce(make(1, [col(0, 0)]), {
      type: 'rowEditText',
      section: 0,
      row: 0,
      patch: { metric_qty: 5, metric_qty_max: 3 },
    });
    s = reduce(s, {
      type: 'stepEdit',
      section: 0,
      step: 0,
      patch: { minutes_min: 9, minutes_max: 2 },
    });
    const codes = issuesFor(s)
      .errors.map((e) => e.code)
      .sort();
    expect(codes).toEqual(['minutes_order', 'qty_range_order']);
  });
  it('a column step on zero rows reports no_rows (shared validator)', () => {
    const s = make(0, [col(0, 0)]);
    expect(issuesFor(s).errors.map((e) => e.code)).toContain('no_rows');
  });
  it('does not duplicate an error that both the validator and the schema report', () => {
    const s = make(3, [col(2, 1)]);
    const errs = issuesFor(s).errors.filter((e) => e.code === 'row_order');
    expect(errs).toHaveLength(1);
  });
  it('a split group in two sections is a cross-section error on the payload', () => {
    const base = reduce(make(1), { type: 'sectionAdd' });
    const d = doc(base);
    const bad = {
      sections: [
        { ...d.sections[0], ingredients: [{ ...d.sections[0].ingredients[0], split_group: 'g' }] },
        {
          ...d.sections[1],
          ingredients: [{ ...d.sections[0].ingredients[0], key: 'q', split_group: 'g' }],
        },
      ],
    };
    expect(issuesFor(bad).errors.map((e) => e.code)).toContain('split_group_cross_section');
  });
});
