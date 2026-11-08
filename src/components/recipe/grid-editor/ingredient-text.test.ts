import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  canAddRow,
  canAddSection,
  doc,
  fromApiRecipe,
  reduce,
  run,
  toGridPayload,
  type EditorIngredient,
  type EditorState,
} from '@/lib/grid/editor';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { apiFromInput } from '../fixtures';
import { parseRowText, portionOf, rowLine } from './ingredient-text';

const start = (): EditorState => fromApiRecipe(apiFromInput(SAMPLE_SKILLET_COOKIES));
const rowsOf = (s: EditorState, si = 0) => doc(s).sections[si].ingredients;

describe('parseRowText', () => {
  it('parses quantity, unit, name and note like the form does', () => {
    const p = parseRowText('3 tbsp butter, softened');
    expect(p.ok && p.fallback).toBe(false);
    if (!p.ok) throw new Error('unreachable');
    expect(p.patch).toMatchObject({ name: 'butter', note: 'softened' });
    expect(p.preview).toContain('3 tbsp');
    expect(p.preview).toContain('butter');
    expect(p.preview).toContain('softened');
  });

  it('falls back to the typed text as the name when nothing parses', () => {
    const p = parseRowText('a little of this and that');
    if (!p.ok) throw new Error('unreachable');
    expect(p.patch.name).toBeTruthy();
    expect(p.patch.metric_qty ?? null).toBeNull();
    expect(p.patch.us_qty ?? null).toBeNull();
  });

  it('rejects empty and whitespace-only text', () => {
    expect(parseRowText('').ok).toBe(false);
    expect(parseRowText('   ').ok).toBe(false);
  });

  it('keeps markup as inert text in the name', () => {
    const p = parseRowText('<img src=x onerror=alert(1)> salt');
    if (!p.ok) throw new Error('unreachable');
    expect(p.patch.name).toContain('<img');
    expect(typeof p.patch.name).toBe('string');
  });

  it('sends no stale other side when 4 oz becomes 6 oz (C7)', () => {
    let s = fromApiRecipe({
      sections: [
        {
          ingredients: [
            {
              name: 'unsalted butter',
              raw_text: '4 oz unsalted butter',
              us_qty: 4,
              us_unit: 'oz',
              metric_qty: 113,
              metric_unit: 'g',
              display_primary: 'us',
            },
          ],
          steps: [],
        },
      ],
    });
    const p = parseRowText('6 oz unsalted butter');
    if (!p.ok) throw new Error('unreachable');
    s = reduce(s, { type: 'rowEditText', section: 0, row: 0, patch: p.patch });
    const r = rowsOf(s)[0];
    expect(r.us_qty).toBe(6);
    expect(r.metric_qty).toBeNull();
    expect(r.metric_unit).toBeNull();
  });
});

describe('rowLine', () => {
  it('prefers the stored line, else composes the primary measure and name', () => {
    const base = rowsOf(start())[0];
    expect(rowLine({ ...base, raw_text: '2 cups flour' })).toBe('2 cups flour');
    const composed: EditorIngredient = {
      ...base,
      raw_text: null,
      display_primary: 'us',
      us_qty: 1.5,
      us_qty_max: null,
      us_unit: 'cup',
      name: 'sugar',
    };
    expect(rowLine(composed)).toBe('1.5 cup sugar');
  });
});

describe('split portions through the reducer', () => {
  it('halves the quantity, shares a group and labels half / remaining', () => {
    let s = fromApiRecipe({
      sections: [
        {
          ingredients: [{ name: 'sugar', us_qty: 1, us_unit: 'cup', display_primary: 'us' }],
          steps: [],
        },
      ],
    });
    s = reduce(s, { type: 'rowSplit', section: 0, row: 0 });
    const [a, b] = rowsOf(s);
    expect(a.split_group).not.toBeNull();
    expect(a.split_group).toBe(b.split_group);
    expect([a.us_qty, b.us_qty]).toEqual([0.5, 0.5]);
    expect([a.portion_label, b.portion_label]).toEqual(['half', 'remaining']);
    expect(portionOf(rowsOf(s), 0)).toEqual({ n: 1, total: 2 });
    expect(portionOf(rowsOf(s), 1)).toEqual({ n: 2, total: 2 });
    const payload = toGridPayload(s, 'x').sections[0].ingredients;
    expect(payload[0].split_group_id).toBe(payload[1].split_group_id);
  });
});

describe('row delete notice and caps', () => {
  it('reports the steps removed with the only row they used', () => {
    let s = fromApiRecipe({
      sections: [
        {
          ingredients: [{ name: 'a' }, { name: 'b' }],
          steps: [{ kind: 'column', label: 'Only b', row_start: 1, row_end: 1 }],
        },
      ],
    });
    const probe = reduce(s, { type: 'rowDelete', section: 0, row: 1 });
    expect(probe.notice).toMatchObject({ type: 'stepsRemoved', labels: ['Only b'] });
    s = run(s, [{ type: 'rowDelete', section: 0, row: 1 }, { type: 'undo' }]);
    expect(rowsOf(s)).toHaveLength(2);
    expect(doc(s).sections[0].steps).toHaveLength(1);
  });

  it('refuses add at 200 rows and 21 sections', () => {
    let s = fromApiRecipe({
      sections: [
        {
          ingredients: Array.from({ length: LIMITS.ingredients }, (_, i) => ({ name: `i${i}` })),
          steps: [],
        },
      ],
    });
    expect(canAddRow(s, 0)).toBe(false);
    expect(reduce(s, { type: 'rowAdd', section: 0 })).toBe(s);
    s = fromApiRecipe({
      sections: Array.from({ length: LIMITS.sections }, (_, i) => ({
        title: `S${i}`,
        ingredients: [],
        steps: [],
      })),
    });
    expect(canAddSection(s)).toBe(false);
    expect(reduce(s, { type: 'sectionAdd' })).toBe(s);
  });
});

describe('sections', () => {
  it('rename and delete are undoable; the last section cannot be deleted', () => {
    const cake = fromApiRecipe(apiFromInput(SAMPLE_VANILLA_CAKE));
    expect(doc(cake).sections.map((x) => x.title)).toEqual(['Cake', 'Frosting']);
    const renamed = reduce(cake, { type: 'sectionRename', section: 1, title: 'Icing' });
    expect(doc(renamed).sections[1].title).toBe('Icing');
    const deleted = reduce(renamed, { type: 'sectionDelete', section: 1 });
    expect(doc(deleted).sections).toHaveLength(1);
    expect(reduce(deleted, { type: 'sectionDelete', section: 0 })).toBe(deleted);
    expect(doc(reduce(deleted, { type: 'undo' })).sections[1].title).toBe('Icing');
  });
});
