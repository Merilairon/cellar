// Test-only helpers (not exported from index.ts).
import { fromApiRecipe, type ApiRecipeLike, type ApiStepLike, type EditorState } from './state';

export const col = (s: number, e: number, label = `c${s}-${e}`): ApiStepLike => ({
  kind: 'column',
  label,
  detail: '',
  row_start: s,
  row_end: e,
});
export const top = (label = 'top'): ApiStepLike => ({ kind: 'banner_top', label, detail: '' });
export const bottom = (label = 'bottom'): ApiStepLike => ({
  kind: 'banner_bottom',
  label,
  detail: '',
});

/** One-section recipe with `rows` ingredients named r0..r(n-1) and the given steps. */
export function recipe(rows: number, steps: ApiStepLike[] = []): ApiRecipeLike {
  return {
    updated_at: '2026-01-01T00:00:00.000Z',
    sections: [
      {
        id: 'sec-1',
        title: null,
        ingredients: Array.from({ length: rows }, (_, i) => ({ id: `ing-${i}`, name: `r${i}` })),
        steps,
      },
    ],
  };
}

export const make = (rows: number, steps: ApiStepLike[] = []): EditorState =>
  fromApiRecipe(recipe(rows, steps));

export const spansOf = (s: EditorState, section = 0) =>
  s.history.present.sections[section].steps.map((t) =>
    t.kind === 'column' ? [t.row_start, t.row_end] : null,
  );
export const names = (s: EditorState, section = 0) =>
  s.history.present.sections[section].ingredients.map((i) => i.name);
