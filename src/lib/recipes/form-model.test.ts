import { describe, expect, it } from 'vitest';
import { recipeInputSchema } from './schemas';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from './samples';
import {
  buildIngredients,
  emptyForm,
  emptyStep,
  errorMap,
  errorMessageKey,
  formFromRecipe,
  formToPayload,
  ingredientLines,
  validateForm,
} from './form-model';

// An API-shaped recipe built from the shared sample (positions + ids added).
function apiShaped(r: typeof SAMPLE_VANILLA_CAKE) {
  return {
    title: r.title,
    description: r.description ?? null,
    servings: r.servings ?? null,
    servings_label: r.servings_label ?? null,
    prep_minutes: r.prep_minutes ?? null,
    cook_minutes: r.cook_minutes ?? null,
    source_url: r.source_url ?? null,
    source_name: r.source_name ?? null,
    visibility: 'private' as const,
    sections: r.sections.map((s) => ({
      title: s.title ?? null,
      ingredients: s.ingredients.map((i, p) => ({ ...i, position: p })),
      steps: s.steps.map((t, p) => ({
        position: p,
        kind: t.kind,
        label: t.label,
        detail: t.detail,
        row_start: t.row_start ?? null,
        row_end: t.row_end ?? null,
        temp_c: t.temp_c ?? null,
        temp_f: t.temp_f ?? null,
        minutes_min: t.minutes_min ?? null,
        minutes_max: t.minutes_max ?? null,
      })),
    })),
  };
}

describe('ingredient ranges', () => {
  it('buildIngredients stores the upper bound and keeps it when the line is unchanged', () => {
    const first = buildIngredients('2-3 tbsp honey', []);
    expect(first[0]).toMatchObject({ us_qty: 2, us_qty_max: 3, us_unit: 'tbsp' });
    const again = buildIngredients('2-3 tbsp honey', first);
    expect(again[0]).toMatchObject({ us_qty: 2, us_qty_max: 3 });
    expect(
      recipeInputSchema.shape.sections.element.shape.ingredients.element.safeParse(again[0])
        .success,
    ).toBe(true);
  });
});

describe('ingredient range fallback text', () => {
  it('rebuilds "a-b" per side when raw_text is missing', () => {
    const api = apiShaped(SAMPLE_SKILLET_COOKIES);
    const ing = api.sections[0]!.ingredients[0]!;
    Object.assign(ing, {
      raw_text: null,
      name: 'honey',
      metric_qty: null,
      metric_unit: null,
      us_qty: 2,
      us_qty_max: 3,
      us_unit: 'tbsp',
    });
    const form = formFromRecipe(api);
    expect(form.sections[0]!.ingredientsText.split('\n')[0]).toBe('2-3 tbsp honey');
  });
});

describe('ingredient lines', () => {
  it('ignores blank lines and trims', () => {
    expect(ingredientLines('  a \n\n  \n b')).toEqual(['a', 'b']);
  });
  it('parses new lines and keeps raw_text', () => {
    const out = buildIngredients('1 cup (200 g) sugar\nsalt to taste', []);
    expect(out[0]).toMatchObject({ name: 'sugar', us_qty: 1, us_unit: 'cup', metric_qty: 200 });
    expect(out[0].raw_text).toBe('1 cup (200 g) sugar');
    expect(out[1].raw_text).toBe('salt to taste');
  });
});

describe('round trip (split ingredients survive an unchanged edit)', () => {
  const form = formFromRecipe(apiShaped(SAMPLE_VANILLA_CAKE));
  const payload = formToPayload(form);

  it('keeps split group ids and portion labels', () => {
    const ings = payload.sections[0].ingredients;
    expect(ings.filter((i) => i.split_group_id === 'sugar').map((i) => i.portion_label)).toEqual([
      'half',
      'remaining',
    ]);
  });
  it('produces a valid payload with 1-based spans converted back to 0-based', () => {
    const f = formFromRecipe(apiShaped(SAMPLE_VANILLA_CAKE));
    expect(f.sections[0].steps[1].rowStart).toBe('1');
    expect(f.sections[0].steps[1].rowEnd).toBe('2');
    expect(recipeInputSchema.safeParse(payload).success).toBe(true);
    const col = payload.sections[0].steps[1];
    expect(col).toMatchObject({ row_start: 0, row_end: 1 });
  });
  it('keeps the portion label of a row whose text was edited', () => {
    const f = formFromRecipe(apiShaped(SAMPLE_VANILLA_CAKE));
    const lines = f.sections[0].ingredientsText.split('\n');
    lines[1] = '1/2 cup (110 g) sugar';
    f.sections[0].ingredientsText = lines.join('\n');
    const row = formToPayload(f).sections[0].ingredients[1];
    expect(row.metric_qty).toBe(110);
    expect(row.portion_label).toBe('half');
  });
  it('does not misassign metadata when a line above is deleted', () => {
    const f = formFromRecipe(apiShaped(SAMPLE_VANILLA_CAKE));
    f.sections[0].ingredientsText = f.sections[0].ingredientsText.split('\n').slice(1).join('\n');
    const ings = formToPayload(f).sections[0].ingredients;
    expect(ings[0].portion_label).toBe('half'); // the sugar row itself, matched by text
    expect(ings.filter((i) => i.portion_label).length).toBe(2);
  });
});

describe('validateForm', () => {
  const filled = () => {
    const f = emptyForm();
    f.title = 'Toast';
    f.sections[0].ingredientsText = 'bread\nbutter';
    return f;
  };
  it('requires a title (inline error at the field path)', () => {
    const f = filled();
    f.title = '';
    const r = validateForm(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(errorMap(r.errors).get('title')).toBe('too_small');
  });
  it('saves as list when a column step has no span', () => {
    const f = filled();
    f.sections[0].steps = [{ ...emptyStep(), label: 'toast' }];
    const r = validateForm(f);
    expect(r).toMatchObject({ ok: true, viewMode: 'list' });
  });
  it('saves as grid when all spans are valid', () => {
    const f = filled();
    f.sections[0].steps = [{ ...emptyStep(), label: 'toast', rowStart: '1', rowEnd: '2' }];
    expect(validateForm(f)).toMatchObject({ ok: true, viewMode: 'grid' });
  });
  it('rejects spans beyond the ingredient count and reversed spans', () => {
    const f = filled();
    f.sections[0].steps = [{ ...emptyStep(), label: 'a', rowStart: '1', rowEnd: '5' }];
    let r = validateForm(f);
    expect(!r.ok && errorMap(r.errors).get('sections.0.steps.0.row_end')).toBe('row_out_of_range');
    f.sections[0].steps = [{ ...emptyStep(), label: 'a', rowStart: '2', rowEnd: '1' }];
    r = validateForm(f);
    expect(!r.ok && errorMap(r.errors).get('sections.0.steps.0.row_end')).toBe('row_order');
  });
  it('flags a half-filled span and a non-numeric value', () => {
    const f = filled();
    f.sections[0].steps = [{ ...emptyStep(), label: 'a', rowStart: '1' }];
    let r = validateForm(f);
    expect(!r.ok && errorMap(r.errors).get('sections.0.steps.0.row_end')).toBe('span_incomplete');
    f.sections[0].steps = [{ ...emptyStep(), label: 'a', rowStart: 'x', rowEnd: '1' }];
    r = validateForm(f);
    expect(r.ok).toBe(false);
  });
  it('maps every reported code to a message key', () => {
    expect(errorMessageKey('row_order')).toBe('recipe.errors.row_order');
    expect(errorMessageKey('something_new')).toBe('recipe.errors.generic');
  });
});
