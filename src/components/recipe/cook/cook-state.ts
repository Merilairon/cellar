import type { ApiSection } from '../types';

/**
 * Cook-mode checkbox keys (G6, Q8): section index + row index / step index within the loaded
 * recipe object. Never an ingredient or step id, because ids change on every save.
 */
export const ingredientKey = (section: number, row: number) => `i:${section}:${row}`;
export const stepKey = (section: number, step: number) => `s:${section}:${step}`;

export function cookTotals(sections: ApiSection[]) {
  return {
    ingredients: sections.reduce((n, s) => n + s.ingredients.length, 0),
    steps: sections.reduce((n, s) => n + s.steps.length, 0),
  };
}

export function cookProgress(checked: ReadonlySet<string>) {
  let ingredients = 0;
  let steps = 0;
  for (const k of checked) {
    if (k.startsWith('i:')) ingredients += 1;
    else if (k.startsWith('s:')) steps += 1;
  }
  return { ingredients, steps };
}

export const toggleKey = (prev: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(prev);
  if (!next.delete(key)) next.add(key);
  return next;
};
