import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { buildSectionLayout } from '@/lib/grid/layout';
import { apiFromInput } from '../fixtures';
import { RecipeGrid } from '../RecipeGrid';
import type { ApiRecipe } from '../types';
import { GridEditor } from './GridEditor';
import { IssuesPanel } from './IssuesPanel';
import { issueText } from './issue-text';
import { issuesFor, fromApiRecipe, doc } from '@/lib/grid/editor';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
const editor = (r: ApiRecipe) => wrap(<GridEditor recipe={r} onClose={() => {}} />);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const attr = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`${name}="(\\d+)"`, 'gi'))].map((m) => Number(m[1]));

const cookie = apiFromInput(SAMPLE_SKILLET_COOKIES);
const cake = apiFromInput(SAMPLE_VANILLA_CAKE);

describe('GridEditor shell', () => {
  const html = editor(cookie);

  it('renders the heading, one polite status region (empty at mount) and the toolbar', () => {
    expect(html).toContain('<h2');
    expect(html).toContain('Grid editor');
    expect(count(html, /role="status"/g)).toBe(1);
    expect(count(html, /aria-live/g)).toBe(0);
    expect(html).toMatch(/role="status" aria-atomic="true" class="sr-only"><\/div>/);
    expect(html).toMatch(/role="group" aria-label="Grid editor actions"/);
    for (const label of ['Undo', 'Redo', 'Done', 'Save changes']) expect(html).toContain(label);
  });

  it('starts clean: Undo, Redo and Save are aria-disabled (still focusable) and Save says why', () => {
    // Toolbar only: row Move buttons and the lone section's Delete are disabled too (T5, T7).
    expect(count(html.split('class="ge-sections"')[0], /aria-disabled="true"/g)).toBe(3);
    expect(html).not.toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
    expect(html).toContain('No changes to save.');
    expect(html).toMatch(/aria-describedby="ge-save-reason"/);
    expect(html).not.toContain('Unsaved changes');
    expect(html).not.toContain('Cancel');
  });

  it('hides the read-view controls and explains the as-written display', () => {
    expect(html).not.toContain('aria-pressed="true"'); // no view toggle selected state
    expect(html).not.toMatch(/Servings|Metric|US customary/i);
    expect(html).toContain('Showing quantities as written');
    expect(html).toContain('Editing the grid.');
  });

  it('shows no problems for a clean sample', () => {
    expect(html).toContain('No problems found.');
  });
});

describe('GridEditorTable semantics', () => {
  for (const [name, recipe] of [
    ['cookie', cookie],
    ['cake', cake],
  ] as const) {
    it(`${name}: same cell structure as the read view`, () => {
      const read = wrap(<RecipeGrid sections={recipe.sections} recipeTitle={recipe.title} />);
      const edit = editor(recipe);
      expect(count(edit, /<table/g)).toBe(count(read, /<table/g));
      expect(attr(edit, 'rowSpan')).toEqual(attr(read, 'rowSpan'));
      expect(attr(edit, 'colSpan')).toEqual(attr(read, 'colSpan'));
      expect(count(edit, /<th scope="row"/g)).toBe(count(read, /<th scope="row"/g));
      expect(count(edit, /<th scope="col"/g)).toBe(count(read, /<th scope="col"/g));
      expect(count(edit, /<caption/g)).toBe(count(read, /<caption/g));
      expect(count(edit, /class="rg-empty"/g)).toBe(count(read, /class="rg-empty"/g));
      // And the spans are the layout's spans.
      const spans = recipe.sections.flatMap((s) =>
        buildSectionLayout(s.ingredients.length, s.steps).columns.map((c) => c.rowSpan),
      );
      expect(attr(edit, 'rowSpan')).toEqual(spans);
    });

    it(`${name}: exactly one tab stop per table (roving tabindex)`, () => {
      const edit = editor(recipe);
      const tables = count(edit, /<table/g);
      expect(count(edit, /data-ge-target="[^"]+" tabindex="0"/g)).toBe(tables);
      expect(count(edit, /data-ge-target="[^"]+" tabindex="-1"/g)).toBeGreaterThan(tables);
      // The scroller must not add a second stop.
      expect(edit).not.toMatch(/class="rg-scroller"[^>]*tabindex="0"/);
      expect(edit).not.toMatch(/tabindex="0"[^>]*class="rg-scroller"/);
    });
  }

  it('ingredient and step buttons carry position text for screen readers', () => {
    const edit = editor(cookie);
    expect(edit).toContain('Row 1 of 9: ');
    expect(edit).toContain('Step 1: ');
    expect(edit).toContain('Uses ');
  });

  it('names a multi-section recipe by section and keeps one table each', () => {
    const edit = editor(cake);
    expect(count(edit, /data-ge-section=/g)).toBe(cake.sections.length);
    expect(cake.sections.length).toBeGreaterThan(1);
  });
});

describe('issues text', () => {
  const broken = () => {
    const s = fromApiRecipe({
      sections: [
        {
          title: null,
          ingredients: [{ name: 'flour' }, { name: 'eggs' }],
          steps: [{ kind: 'column', label: 'Mix', row_start: 0, row_end: 0 }],
        },
        { title: 'Frosting', ingredients: [], steps: [] },
      ],
    });
    return doc(s);
  };

  it('lists the uncovered row as a warning and the empty section, none blocking', () => {
    const d = broken();
    const { errors, warnings } = issuesFor(d);
    expect(errors).toEqual([]);
    const html = wrap(
      <IssuesPanel
        doc={d}
        errors={errors}
        warnings={warnings}
        headingRef={null}
        onGoTo={() => {}}
      />,
    );
    expect(html).toContain('No step covers: eggs.');
    expect(html).toContain('Frosting has no ingredients.');
    expect(count(html, /Go to/g)).toBe(2);
    expect(html).toContain('Warning');
  });

  it('every code the editor can emit has a message, and unknown codes fall back', () => {
    const d = broken();
    const codes = [
      'row_uncovered',
      'positions_not_contiguous',
      'banner_has_span',
      'span_required_for_grid',
      'span_incomplete',
      'row_order',
      'row_out_of_range',
      'no_rows',
      'split_group_cross_section',
      'name_empty',
      'label_empty',
      'banner_empty',
      'section_empty',
    ];
    const issue = messages.gridEditor.issue as Record<string, string>;
    for (const code of codes) {
      const { key } = issueText(d, { path: 'sections.0.steps.0.row_start', code, target: null });
      expect(issue[key], code).toBeTruthy();
    }
    expect(issueText(d, { path: 'x', code: 'weird', target: null }).key).toBe('unknown');
  });

  it('errors render as Problems', () => {
    const d = broken();
    const html = wrap(
      <IssuesPanel
        doc={d}
        errors={[{ path: 'sections.0.steps.0.row_end', code: 'row_order', target: null }]}
        warnings={[]}
        headingRef={null}
        onGoTo={() => {}}
      />,
    );
    expect(html).toContain('Problem');
    expect(html).toContain('Mix: the last row cannot be before the first row.');
  });
});

describe('wiring guards', () => {
  const src = (p: string) => readFileSync(join(__dirname, p), 'utf8');

  it('the editor is a dynamic import in RecipeView and not statically imported anywhere', () => {
    const view = src('../RecipeView.tsx');
    expect(view).toMatch(/dynamic\(\(\) => import\('\.\/grid-editor\/GridEditor'\)/);
    expect(view).not.toMatch(/^import .* from '\.\/grid-editor/m);
  });

  it('the read view does not know about the editor', () => {
    expect(src('../RecipeGrid.tsx')).not.toMatch(/grid-editor/);
  });

  it('every literal gridEditor.* key used in the editor sources exists in en.json', () => {
    const files = [
      'GridEditor.tsx',
      'GridEditorTable.tsx',
      'IssuesPanel.tsx',
      'text.ts',
      '../RecipeView.tsx',
    ];
    const used = new Set<string>();
    for (const f of files)
      for (const m of src(f).matchAll(/['`]gridEditor\.([A-Za-z_.]+)['`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(15);
    const missing = [...used].filter(
      (k) => k.split('.').reduce<unknown>((o, p) => (o as never)?.[p], messages.gridEditor) == null,
    );
    expect(missing).toEqual([]);
  });

  it('every template key family resolves for all values the code can produce', () => {
    const g = messages.gridEditor as unknown as Record<string, Record<string, string>>;
    for (const k of [
      'undone',
      'redone',
      'undoneGeneric',
      'redoneGeneric',
      'nothingToUndo',
      'nothingToRedo',
      'allCovered',
    ])
      expect(g.announce[k], k).toBeTruthy();
    for (const k of [
      'rowMove',
      'rowAdd',
      'rowDelete',
      'rowSplit',
      'rowEdit',
      'stepAdd',
      'stepDelete',
      'stepMove',
      'stepResize',
      'stepConvert',
      'stepEdit',
      'bannerAdd',
      'sectionAdd',
      'sectionRename',
      'sectionDelete',
      'sectionMove',
    ])
      expect(g.history[k], k).toBeTruthy();
    for (const k of ['saveDisabledClean', 'saveDisabledErrors']) expect(g.toolbar[k]).toBeTruthy();
  });
});
