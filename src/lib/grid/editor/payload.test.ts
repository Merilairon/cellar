import { describe, expect, it } from 'vitest';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { gridPayloadSchemaCheck, recreateSection } from './sample-recreation';
import { validateRecipeGrid } from '../validate';
import { sectionInputSchema } from '@/lib/recipes/schemas';
import { reduce, run } from './reducer';
import { doc, fromApiRecipe, toGridPayload, type EditorState } from './state';
import { issuesFor } from './issues';

const ING = [
  'note',
  'raw_text',
  'metric_qty',
  'metric_qty_max',
  'metric_unit',
  'us_qty',
  'us_qty_max',
  'us_unit',
  'split_group_id',
  'portion_label',
  'group_label',
];
const STP = ['row_start', 'row_end', 'temp_c', 'temp_f', 'minutes_min', 'minutes_max'];
const fill = (o: Record<string, unknown>, keys: string[]) => ({
  ...Object.fromEntries(keys.map((k) => [k, null])),
  ...o,
});
// Parse through the API schema, then make absent optional fields explicit nulls.
const parsed = (sections: unknown[]) =>
  sections.map((s) => {
    const p = sectionInputSchema.parse(s);
    return {
      ...p,
      ingredients: p.ingredients.map((i) => fill(i, ING)),
      steps: p.steps.map((x) => fill(x, STP)),
    };
  });

describe('toGridPayload / fromApiRecipe round trip', () => {
  for (const sample of [SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE]) {
    it(`${sample.title}: payload is accepted by the API schema, valid, and equals the stored sections`, () => {
      const s = fromApiRecipe(sample);
      const p = toGridPayload(s, '2026-01-01T00:00:00.000Z');
      expect(gridPayloadSchemaCheck(p)).toEqual([]);
      expect(validateRecipeGrid(p).errors).toEqual([]);
      expect(parsed(p.sections)).toEqual(parsed(sample.sections));
      expect(issuesFor(s).errors).toEqual([]);
    });
  }

  it('emits arrays only: no ids, no positions, no keys', () => {
    const p = toGridPayload(fromApiRecipe(SAMPLE_VANILLA_CAKE), 'x');
    expect(Object.keys(p).sort()).toEqual(['base_updated_at', 'sections']);
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/"(id|position|key)"/);
    expect(p.sections[0].steps.map((t) => t.kind)).toEqual([
      'banner_top',
      'column',
      'column',
      'column',
      'column',
      'column',
    ]);
  });

  it('carries base_updated_at through unchanged', () => {
    expect(toGridPayload(fromApiRecipe(SAMPLE_SKILLET_COOKIES), 'T').base_updated_at).toBe('T');
  });

  it('banners always serialize null spans, even if state were inconsistent', () => {
    const s = fromApiRecipe(SAMPLE_SKILLET_COOKIES);
    const p = toGridPayload(s, 'x');
    expect(
      p.sections[0].steps
        .filter((t) => t.kind !== 'column')
        .every((t) => t.row_start === null && t.row_end === null),
    ).toBe(true);
  });

  it('an unchanged line keeps both stored sides; an edited quantity sends the other side as null (C7)', () => {
    let s: EditorState = fromApiRecipe(SAMPLE_SKILLET_COOKIES);
    expect(toGridPayload(s, 'x').sections[0].ingredients[0]).toMatchObject({
      metric_qty: 115,
      us_qty: 4,
    });
    s = reduce(s, { type: 'rowEditText', section: 0, row: 0, patch: { us_qty: 5 } });
    expect(toGridPayload(s, 'x').sections[0].ingredients[0]).toMatchObject({
      us_qty: 5,
      metric_qty: null,
      metric_unit: null,
      metric_qty_max: null,
    });
    expect(toGridPayload(s, 'x').sections[0].ingredients[1]).toMatchObject({ us_qty: 0.75 });
  });

  it('client keys survive the payload round trip with server ids replaced (G4)', () => {
    const before = fromApiRecipe(SAMPLE_VANILLA_CAKE);
    const afterSave = run(before, [{ type: 'markSaved' }]);
    expect(doc(afterSave).sections[0].key).toBe(doc(before).sections[0].key);
  });
});

describe('acceptance: sample grids recreated purely from reducer actions', () => {
  it('Mocha Skillet Cookie from one empty section equals SAMPLE_SKILLET_COOKIES', () => {
    const empty = fromApiRecipe({ sections: [{ title: null, ingredients: [], steps: [] }] });
    const s = run(empty, recreateSection(SAMPLE_SKILLET_COOKIES.sections[0], 0));
    const p = toGridPayload(s, 'x');
    expect(parsed(p.sections)).toEqual(parsed(SAMPLE_SKILLET_COOKIES.sections));
    expect(validateRecipeGrid(p).errors).toEqual([]);
    expect(issuesFor(s).errors).toEqual([]);
    expect(issuesFor(s).warnings).toEqual([]);
  });

  it('Vanilla Cake (two sections, split sugar, bottom banner) equals SAMPLE_VANILLA_CAKE', () => {
    const empty = fromApiRecipe({ sections: [{ title: null, ingredients: [], steps: [] }] });
    const s = run(empty, [
      { type: 'sectionRename', section: 0, title: 'Cake' },
      ...recreateSection(SAMPLE_VANILLA_CAKE.sections[0], 0),
      { type: 'sectionAdd', title: 'Frosting' },
      ...recreateSection(SAMPLE_VANILLA_CAKE.sections[1], 1),
    ]);
    const p = toGridPayload(s, 'x');
    // Group keys are client-chosen; compare structurally by renaming the one group to 'sugar'.
    const g = p.sections[0].ingredients.find((i) => i.split_group_id)!.split_group_id;
    const renamed = p.sections.map((sec) => ({
      ...sec,
      ingredients: sec.ingredients.map((i) =>
        i.split_group_id === g ? { ...i, split_group_id: 'sugar' } : i,
      ),
    }));
    expect(parsed(renamed)).toEqual(parsed(SAMPLE_VANILLA_CAKE.sections));
    expect(validateRecipeGrid(p).errors).toEqual([]);
    expect(issuesFor(s).errors).toEqual([]);
  });

  it('the recreation is fully undoable back to the empty section', () => {
    const empty = fromApiRecipe({ sections: [{ title: null, ingredients: [], steps: [] }] });
    let s = run(empty, recreateSection(SAMPLE_SKILLET_COOKIES.sections[0], 0));
    expect(s.history.past.length).toBeGreaterThan(15);
    while (s.history.past.length) s = reduce(s, { type: 'undo' });
    expect(doc(s)).toEqual(doc(empty));
  });
});
