import { describe, expect, it } from 'vitest';
import type { Draft } from '@/lib/import/normalize';
import {
  formFromDraft,
  formFromDraftMode,
  formToPreviewSections,
  previewIssues,
  sectionsSignature,
  withSections,
} from './form-model';

const ing = (name: string) => ({ name, raw_text: name, display_primary: 'metric' as const });
const draft = {
  title: 'Soup',
  description: 'Warm',
  servings: 2,
  source_url: 'https://example.com/s',
  sections: [
    {
      title: null,
      ingredients: [ing('onion'), ing('water')],
      steps: [{ kind: 'column', label: 'Boil', detail: 'Boil water' }],
    },
  ],
  tags: [],
  cover_image_url: null,
  mapping: {
    confidence: 0.8,
    level: 'high',
    version: 1,
    warnings: [],
    signals: {},
    sections: [
      {
        title: null,
        ingredients: [ing('water'), ing('onion')],
        steps: [{ kind: 'column', label: 'Boil', detail: 'Boil water', row_start: 0, row_end: 1 }],
      },
    ],
  },
} as unknown as Draft;

describe('formFromDraftMode', () => {
  it('list is the page order with empty spans; grid is the proposal with 1-based spans', () => {
    const list = formFromDraftMode(draft, 'list');
    expect(list).toEqual(formFromDraft(draft));
    expect(list.sections[0].ingredientsText).toBe('onion\nwater');
    expect(list.sections[0].steps[0].rowStart).toBe('');
    const grid = formFromDraftMode(draft, 'grid');
    expect(grid.sections[0].ingredientsText).toBe('water\nonion');
    expect([grid.sections[0].steps[0].rowStart, grid.sections[0].steps[0].rowEnd]).toEqual([
      '1',
      '2',
    ]);
  });

  it('grid without a proposal falls back to the list', () => {
    expect(formFromDraftMode({ ...draft, mapping: null }, 'grid')).toEqual(formFromDraft(draft));
  });

  it('withSections replaces only sections', () => {
    const f = { ...formFromDraftMode(draft, 'list'), title: 'Edited', description: 'mine' };
    const g = withSections(f, formFromDraftMode(draft, 'grid').sections);
    expect(g.title).toBe('Edited');
    expect(g.description).toBe('mine');
    expect(g.sections[0].ingredientsText).toBe('water\nonion');
  });
});

describe('sectionsSignature', () => {
  it('ignores row keys and notices content edits', () => {
    const a = formFromDraftMode(draft, 'grid');
    const b = structuredClone(a);
    b.sections[0].key = 'other';
    expect(sectionsSignature(b.sections)).toBe(sectionsSignature(a.sections));
    b.sections[0].steps[0].rowEnd = '1';
    expect(sectionsSignature(b.sections)).not.toBe(sectionsSignature(a.sections));
  });
});

describe('preview', () => {
  it('builds grid sections with index ids and 0-based spans', () => {
    const [s] = formToPreviewSections(formFromDraftMode(draft, 'grid'));
    expect(s.id).toBe('pv-s0');
    expect(s.ingredients.map((i) => [i.id, i.name])).toEqual([
      ['pv-s0-i0', 'water'],
      ['pv-s0-i1', 'onion'],
    ]);
    expect([s.steps[0].id, s.steps[0].row_start, s.steps[0].row_end]).toEqual(['pv-s0-t0', 0, 1]);
  });

  it('proposal is valid; list (no spans) and bad spans are reported', () => {
    expect(previewIssues(formFromDraftMode(draft, 'grid'))).toEqual([]);
    expect(previewIssues(formFromDraftMode(draft, 'list')).map((e) => e.code)).toEqual([
      'span_required_for_grid',
    ]);
    const bad = formFromDraftMode(draft, 'grid');
    bad.sections[0].steps[0].rowEnd = '9';
    expect(previewIssues(bad).map((e) => e.code)).toEqual(['row_out_of_range']);
    bad.sections[0].steps[0].rowStart = '3';
    expect(previewIssues(bad)[0].path).toBe('sections.0.steps.0.row_start');
  });
});
