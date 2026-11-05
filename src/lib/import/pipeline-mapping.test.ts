import { describe, expect, it, vi } from 'vitest';
import { recipeInputSchema } from '@/lib/recipes/schemas';
import { validateRecipeGrid } from '@/lib/grid/validate';
import { MAX_DRAFT_BYTES, MAX_MAPPING_BYTES, attachMapping, readMapping } from './mapping';
import { mapGrid } from './map-grid';
import { MAP_LIMITS } from './map-types';
import type { MapInput, MapResult, MappingProposal } from './map-types';
import type { Draft } from './normalize';
import { runImport } from './pipeline';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import type { SafeFetchOptions, SafeFetchResult } from './safe-fetch';

const enc = new TextEncoder();
const page = (node: unknown) =>
  `<html><script type="application/ld+json">${JSON.stringify(node)}</script></html>`;
const fetchOf = (body: string, finalUrl = 'https://example.com/final') =>
  vi.fn<(u: string, o?: SafeFetchOptions) => Promise<SafeFetchResult>>(async () => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: enc.encode(body),
    finalUrl,
  }));

const CAKE = {
  '@type': 'Recipe',
  name: 'Layer Cake',
  recipeIngredient: [
    '2 cups flour',
    '1 cup sugar',
    '3 eggs',
    'For the frosting:',
    '1 cup butter',
    '2 cups powdered sugar',
  ],
  recipeInstructions: [
    {
      '@type': 'HowToSection',
      name: 'Cake',
      itemListElement: [
        { '@type': 'HowToStep', text: 'Whisk the flour and sugar.' },
        { '@type': 'HowToStep', text: 'Beat in the eggs.' },
        { '@type': 'HowToStep', text: 'Bake for 30 minutes at 180C.' },
      ],
    },
    {
      '@type': 'HowToSection',
      name: 'Frosting',
      itemListElement: [
        { '@type': 'HowToStep', text: 'Cream the butter.' },
        { '@type': 'HowToStep', text: 'Beat in the powdered sugar.' },
      ],
    },
  ],
};

describe('pipeline wires the mapper into draft.mapping', () => {
  it('a HowToSection recipe gets a proposal with named sections; the 3a sections stay flat', async () => {
    const r = await runImport(
      { url: 'https://example.com/cake' },
      { safeFetch: fetchOf(page(CAKE)) },
    );
    expect(r.status).toBe('needs_review');
    const d = r.draft!;
    // 3a list draft untouched: one section, prefixed text, no spans, list view.
    expect(d.sections).toHaveLength(1);
    expect(d.view_mode).toBe('list');
    expect(d.sections[0]!.steps[0]!.detail).toBe('Cake: Whisk the flour and sugar.');
    expect(d.sections[0]!.steps.every((s) => s.row_start === null && s.row_end === null)).toBe(
      true,
    );
    // Proposal beside it.
    const m = d.mapping!;
    expect(m.version).toBe(1);
    expect(m.sections.map((s) => s.title)).toEqual(['Cake', 'Frosting']);
    expect(m.sections[0]!.steps[0]!.detail).toBe('Whisk the flour and sugar.');
    expect(validateRecipeGrid({ sections: m.sections }).errors).toEqual([]);
    expect(recipeInputSchema.safeParse({ title: 'x', sections: m.sections }).success).toBe(true);
  });

  it('the paste path maps too, with For the ... headings as sections (G15)', async () => {
    const text = [
      'Pasta',
      'Ingredients',
      '200 g pasta',
      'For the sauce:',
      '2 tbsp butter',
      '1 cup cream',
      'Method',
      'Boil the pasta.',
      'Drain the pasta.',
      'For the sauce:',
      'Melt the butter.',
      'Stir in the cream.',
    ].join('\n');
    const r = await runImport({ text });
    expect(r.method).toBe('paste');
    expect(r.draft!.mapping).not.toBeNull();
    expect(r.draft!.mapping!.sections.map((s) => s.title)).toEqual([null, 'Sauce']);
  });

  it('sample A text maps with high confidence through the whole pipeline', async () => {
    const node = {
      '@type': 'Recipe',
      name: SAMPLE_SKILLET_COOKIES.title,
      recipeIngredient: SAMPLE_SKILLET_COOKIES.sections[0]!.ingredients.map((i) => i.raw_text),
      recipeInstructions: SAMPLE_SKILLET_COOKIES.sections[0]!.steps.map((s) => s.detail),
    };
    const r = await runImport({ url: 'https://example.com/a' }, { safeFetch: fetchOf(page(node)) });
    expect(r.draft!.mapping!.level).toBe('high');
    expect(r.draft!.mapping!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('mapping failures never fail the import and leave the 3a draft intact', async () => {
    const baseline = await runImport(
      { url: 'https://example.com/c' },
      { safeFetch: fetchOf(page(CAKE)) },
    );
    const log = vi.fn();
    const throwing = await runImport(
      { url: 'https://example.com/c' },
      {
        safeFetch: fetchOf(page(CAKE)),
        mapGrid: () => {
          throw new Error('boom');
        },
        log,
      },
    );
    expect(throwing.status).toBe('needs_review');
    expect(throwing.draft!.mapping).toBeNull();
    expect(throwing.warnings).toContain('mapping_invalid');
    expect(log).toHaveBeenCalledWith('mapping failed: unexpected', expect.any(Error));
    expect({ ...throwing.draft!, mapping: null }).toEqual({ ...baseline.draft!, mapping: null });
  });

  it('a budget stop falls back to list mode with mapping_budget (via the real mapper)', async () => {
    const r = await runImport(
      { url: 'https://example.com/c' },
      { safeFetch: fetchOf(page(CAKE)), mapGrid: (i) => mapGrid(i, { budget: 3 }) },
    );
    expect(r.status).toBe('needs_review');
    expect(r.draft!.mapping).toBeNull();
    expect(r.draft!.view_mode).toBe('list');
    expect(r.warnings).toContain('mapping_budget');
  });

  it('invalid output and "error" reasons surface mapping_invalid; empty adds nothing', () => {
    const draft = { mapping: null } as unknown as Draft;
    const input = { ingredients: [], steps: [] } as MapInput;
    const run = (r: MapResult) => attachMapping(draft, input, { mapGrid: () => r });
    expect(
      run({ mapped: false, reason: 'invalid', warnings: ['mapping_invalid'] }).warnings,
    ).toEqual(['mapping_invalid']);
    expect(run({ mapped: false, reason: 'error', warnings: [] }).warnings).toEqual([
      'mapping_invalid',
    ]);
    expect(run({ mapped: false, reason: 'empty', warnings: [] }).warnings).toEqual([]);
    expect(
      run({ mapped: false, reason: 'too_many_sections', warnings: ['too_many_sections'] }).warnings,
    ).toEqual(['too_many_sections']);
    // Free-text style codes from the mapper are not copied into the page notes.
    expect(
      run({
        mapped: false,
        reason: 'invalid',
        warnings: ['ingredient_unmentioned:x', 'mapping_invalid'],
      }).warnings,
    ).toEqual(['mapping_invalid']);
  });

  it('no mapInput means no mapping and no warning', () => {
    const out = attachMapping({ mapping: null } as unknown as Draft, null);
    expect(out).toEqual({ draft: { mapping: null }, warnings: [] });
  });
});

describe('draft size guard (G11)', () => {
  const proposalWith = (detailChars: number): MappingProposal => ({
    confidence: 0.9,
    level: 'high',
    sections: [
      {
        title: null,
        ingredients: [{ name: 'flour' } as never],
        steps: [{ kind: 'column', label: 'x', detail: 'y'.repeat(detailChars) } as never],
      },
    ],
    warnings: [],
    signals: {
      cov: 1,
      unamb: 1,
      verbs: 1,
      splitOk: 1,
      secFactor: 1,
      groupRefs: 0,
      columnSteps: 1,
      distinctSpans: 1,
    },
    version: 1,
  });
  const draft = (extra = 0) =>
    ({ title: 't', sections: [{ steps: ['z'.repeat(extra)] }], mapping: null }) as unknown as Draft;
  const input = { ingredients: [], steps: [] } as MapInput;

  it('keeps a proposal under 512 KB', () => {
    const out = attachMapping(draft(), input, {
      mapGrid: () => ({ mapped: true, proposal: proposalWith(1000) }),
    });
    expect(out.draft.mapping).not.toBeNull();
    expect(out.warnings).toEqual([]);
  });
  it('drops a proposal above 512 KB with mapping_too_large and keeps the draft', () => {
    const out = attachMapping(draft(), input, {
      mapGrid: () => ({ mapped: true, proposal: proposalWith(MAX_MAPPING_BYTES + 10) }),
    });
    expect(out.draft.mapping).toBeNull();
    expect(out.draft.title).toBe('t');
    expect(out.warnings).toEqual(['mapping_too_large']);
  });
  it('drops the proposal when the whole draft would exceed 1 MB', () => {
    const out = attachMapping(draft(MAX_DRAFT_BYTES - 1000), input, {
      mapGrid: () => ({ mapped: true, proposal: proposalWith(5000) }),
    });
    expect(out.draft.mapping).toBeNull();
    expect(out.warnings).toEqual(['mapping_too_large']);
  });

  it('a maximal real draft (200 ingredients, 100 steps of 4000 chars) stays below 1 MB', async () => {
    const node = {
      '@type': 'Recipe',
      name: 'Max',
      recipeIngredient: Array.from({ length: 200 }, (_, i) => `1 cup item${i}`),
      recipeInstructions: Array.from(
        { length: 100 },
        (_, s) => `Stir the item${s} ` + 'word '.repeat(790),
      ),
    };
    const r = await runImport(
      { url: 'https://example.com/max' },
      { safeFetch: fetchOf(page(node)) },
    );
    expect(r.status).toBe('needs_review');
    const bytes = enc.encode(JSON.stringify({ v: 1, draft: r.draft, warnings: r.warnings })).length;
    expect(bytes).toBeLessThan(1024 * 1024);
    // The mapper caps total step text, so it either maps within the guard or reports why not.
    if (!r.draft!.mapping) expect(r.warnings.length).toBeGreaterThan(0);
    expect(MAP_LIMITS.totalStepChars).toBeLessThan(MAX_MAPPING_BYTES);
  });
});

describe('readMapping (old and tampered drafts, G21)', () => {
  const good = (): MappingProposal => ({
    confidence: 0.8,
    level: 'high',
    sections: SAMPLE_SKILLET_COOKIES.sections,
    warnings: [],
    signals: {} as never,
    version: 1,
  });
  it('accepts a well-formed proposal', () => expect(readMapping(good())).not.toBeNull());
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string', 'x'],
    ['array', []],
    ['wrong version', { ...good(), version: 2 }],
    ['confidence out of range', { ...good(), confidence: 1.5 }],
    ['confidence NaN', { ...good(), confidence: NaN }],
    ['bad level', { ...good(), level: 'great' }],
    ['no sections', { ...good(), sections: [] }],
    ['sections that are not sections', { ...good(), sections: [{ foo: 'bar' }] }],
    [
      'span of the wrong type',
      { ...good(), sections: [{ title: null, ingredients: [], steps: [{ kind: 'column' }] }] },
    ],
    ['non-string warning', { ...good(), warnings: [1] }],
    ['no signals', { ...good(), signals: null }],
  ])('rejects %s', (_n, v) => expect(readMapping(v)).toBeNull());
});
