import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Draft } from '@/lib/import/normalize';
import type { MappingProposal } from '@/lib/import/map-types';
import { nextKey } from '@/lib/recipes/form-model';
import { RecipeForm } from '@/components/recipe/RecipeForm';
import { ReviewForm } from './ReviewForm';
import { warningMessage } from './warnings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}));

const ing = (name: string) => ({ name, raw_text: name, display_primary: 'metric' as const });
const proposal = (
  level: MappingProposal['level'],
  warnings: string[] = [],
  confidence = 0.8,
): MappingProposal =>
  ({
    confidence,
    level,
    version: 1,
    warnings,
    signals: {},
    sections: [
      {
        title: null,
        ingredients: [ing('water'), ing('onion')],
        steps: [{ kind: 'column', label: 'Boil it', detail: 'Boil', row_start: 0, row_end: 1 }],
      },
    ],
  }) as unknown as MappingProposal;

const draft = (mapping: MappingProposal | null) =>
  ({
    title: 'Soup',
    description: null,
    servings: 2,
    source_url: 'https://example.com/soup',
    source_name: null,
    tags: [],
    cover_image_url: null,
    sections: [
      {
        title: null,
        ingredients: [ing('onion'), ing('water')],
        steps: [{ kind: 'column', label: 'Boil it', detail: 'Boil' }],
      },
    ],
    mapping,
  }) as unknown as Draft;

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
    {node}
  </NextIntlClientProvider>
);
const review = (d: Draft) =>
  wrap(<ReviewForm jobId="J1" draft={d} warnings={[]} duplicate={null} />);
const html = (d: Draft) => renderToStaticMarkup(review(d));

describe('ReviewForm mapping panel', () => {
  it('high: grid preview open, "Good match" as text, use-list action', () => {
    const h = html(draft(proposal('high')));
    expect(h).toContain('Good match');
    expect(h).toContain('Will be saved as: Grid');
    expect(h).toContain('Proposal applied.');
    expect(h).toContain('Use list view instead');
    expect(h).not.toContain('Reset to proposal');
    expect(h).toContain('Grid preview');
    expect(h).toContain('class="rg-table"');
    expect(h).toContain('role="status"');
    expect(h).toContain('<svg aria-hidden="true"');
    // proposal order is used: water before onion
    expect(h.indexOf('water')).toBeLessThan(h.indexOf('onion'));
  });

  it('medium: list by default with Preview as grid, reasons open, no preview', () => {
    const h = html(draft(proposal('medium', ['group_reference'], 0.55)));
    expect(h).toContain('Check the mapping');
    expect(h).toContain('Will be saved as: List');
    expect(h).toContain('Preview as grid');
    expect(h).not.toContain('Try the grid anyway');
    expect(h).not.toContain('class="rg-table"');
    expect(h).toContain('Match score: 0.55 out of 1');
    expect(h).toContain('A step says');
    expect(h).toMatch(/<details open=""[^>]*><summary[^>]*>Why this score/);
  });

  it('low: secondary "Try the grid anyway" after the reasons, fallback reason', () => {
    const h = html(draft(proposal('low', [], 0.2)));
    expect(h).toContain('Could not map reliably');
    expect(h).toContain('Try the grid anyway');
    expect(h).not.toContain('Preview as grid');
    expect(h).toContain('No single problem stood out');
    expect(h.indexOf('Why this score')).toBeLessThan(h.indexOf('Try the grid anyway'));
  });

  it('shows at most five reasons and counts the rest', () => {
    const w = Array.from({ length: 8 }, (_, i) => `ingredient_unmentioned:item${i}`);
    const h = html(draft(proposal('medium', w)));
    expect(h).toContain('item4 is not mentioned');
    expect(h).not.toContain('item5 is not mentioned');
    expect(h).toContain('and 3 more');
  });

  it('mapping null: no panel, no preview, v0.3.0 markup', () => {
    const h = html(draft(null));
    expect(h).not.toContain('Automatic grid');
    expect(h).not.toContain('Grid preview');
    expect(h).not.toContain('role="status"');
    // unknown mapping version is treated as none
    const bad = { ...proposal('high'), version: 2 } as unknown as MappingProposal;
    expect(html(draft(bad))).not.toContain('Automatic grid');
  });

  it('renders imported names as text, never markup', () => {
    const d = draft(proposal('medium', ['ambiguous_name:<img src=x onerror=alert(1)>']));
    d.mapping!.sections[0].ingredients[0].name = '<b>bold</b>';
    const h = html(d);
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('warningMessage for mapper codes', () => {
  const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`;
  it('passes page text as an ICU value and resolves every code', () => {
    expect(warningMessage(t, 'ingredient_unmentioned:salt: fine')).toBe(
      'import.warning.ingredient_unmentioned{"name":"salt: fine"}',
    );
    expect(warningMessage(t, 'ambiguous_name:egg')).toBe(
      'import.warning.ambiguous_name{"token":"egg"}',
    );
    expect(warningMessage(t, 'warnings_more:12')).toBe('import.warning.warnings_more{"count":12}');
    expect(warningMessage(t, 'group_reference')).toBe('import.warning.group_reference');
    expect(warningMessage(t, 'constructor')).toBe('import.warning.generic');
    expect(warningMessage(t, 'group_reference:x')).toBe('import.warning.generic');
  });
  it('every mapper code has a catalogue message', () => {
    const codes = [
      'ingredient_unmentioned:a',
      'ambiguous_name:a',
      'split_unresolved:a',
      'group_reference',
      'step_without_ingredients',
      'sections_from_ingredients_only',
      'section_merged',
      'ingredient_shared_across_sections',
      'too_many_sections',
      'input_truncated',
      'time_ambiguous',
      'mapping_invalid',
      'mapping_budget',
      'mapping_too_large',
      'warnings_more:3',
    ];
    for (const c of codes) expect(warningMessage(t, c)).not.toBe('import.warning.generic');
  });
});

describe('hydration: no nextKey during render (T13)', () => {
  // nextKey is a module counter; if render called it, the counter would move between our probes.
  const probe = (render: () => string) => {
    const before = Number(nextKey().slice(1));
    const out = render();
    expect(Number(nextKey().slice(1))).toBe(before + 1);
    return out;
  };
  it('RecipeForm (new, edit-shaped initial)', () => {
    const a = probe(() => renderToString(wrap(<RecipeForm />)));
    const b = probe(() => renderToString(wrap(<RecipeForm />)));
    expect(a).toBe(b);
  });
  it('ReviewForm with high, low and no mapping renders identically twice', () => {
    for (const m of [proposal('high'), proposal('low', [], 0.1), null]) {
      const a = probe(() => renderToString(review(draft(m))));
      nextKey(); // another request advanced the counter
      const b = probe(() => renderToString(review(draft(m))));
      expect(a).toBe(b);
    }
  });
});

describe('plain-text rendering', () => {
  it('no new component uses dangerouslySetInnerHTML', () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => /^Mapping.*\.tsx$|^ReviewForm\.tsx$/.test(n))) {
      expect(readFileSync(join(dir, f), 'utf8')).not.toContain('dangerouslySetInnerHTML');
    }
  });
});
