// Test and report helpers for the auto-mapper: structure extraction, comparison, and
// derivation of mapper input from a finished recipe (tasklist G1). Not part of the mapper.

import { rowKey } from '@/lib/import/ingredient-match';
import { titleKey } from '@/lib/import/map-sections';
import type { MapInput } from '@/lib/import/map-types';
import type { IngredientInput, RecipeInput } from '@/lib/recipes/schemas';

export type StepShape = { kind: string; row_start: number | null; row_end: number | null };
export type SplitShape = { name: string; portions: string[] };
export type SectionShape = {
  title: string | null;
  rows: string[];
  split: SplitShape[];
  steps: StepShape[];
};
export type Structure = SectionShape[];

type SectionLike = {
  title?: string | null;
  ingredients: Array<{
    name: string;
    split_group_id?: string | null;
    portion_label?: string | null;
  }>;
  steps: Array<{ kind: string; row_start?: number | null; row_end?: number | null }>;
};

export function structureOf(sections: SectionLike[]): Structure {
  return sections.map((s) => {
    const groups = new Map<string, SplitShape>();
    for (const i of s.ingredients) {
      if (!i.split_group_id) continue;
      const g = groups.get(i.split_group_id) ?? { name: rowKey(i.name), portions: [] };
      g.portions.push(i.portion_label ?? '');
      groups.set(i.split_group_id, g);
    }
    return {
      title: s.title ? titleKey(s.title) : null,
      rows: s.ingredients.map((i) => rowKey(i.name)),
      split: [...groups.values()],
      steps: s.steps.map((st) => ({
        kind: st.kind,
        row_start: st.row_start ?? null,
        row_end: st.row_end ?? null,
      })),
    };
  });
}

/** Expected shape as written in fixture JSON (titles and names are normalized on compare). */
export type ExpectedSection = {
  title: string | null;
  rows: string[];
  split?: SplitShape[];
  steps: Array<{ kind: string; row_start?: number; row_end?: number }>;
};

export function normalizeExpected(sections: ExpectedSection[]): Structure {
  return sections.map((s) => ({
    title: s.title ? titleKey(s.title) : null,
    rows: s.rows.map((r) => rowKey(r)),
    split: (s.split ?? []).map((g) => ({ name: rowKey(g.name), portions: g.portions })),
    steps: s.steps.map((st) => ({
      kind: st.kind,
      row_start: st.kind === 'column' ? (st.row_start ?? 0) : null,
      row_end: st.kind === 'column' ? (st.row_end ?? null) : null,
    })),
  }));
}

export type Comparison = { exact: boolean; stepsRight: number; stepsTotal: number };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function compareStructure(got: Structure | null, want: Structure): Comparison {
  const stepsTotal = want.reduce((n, s) => n + s.steps.length, 0);
  if (!got) return { exact: false, stepsRight: 0, stepsTotal };
  let stepsRight = 0;
  if (got.length === want.length) {
    want.forEach((w, si) => {
      const g = got[si]!;
      w.steps.forEach((st, k) => {
        if (same(g.steps[k], st)) stepsRight++;
      });
    });
  }
  return { exact: same(got, want), stepsRight, stepsTotal };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mapper input from a finished recipe: every step.detail in order (kind, spans and labels
 * dropped, the section title kept as a hint), every ingredient with split rows collapsed to
 * one line (quantities summed) and the section title as group_label, in a seeded shuffle.
 */
export function deriveMapInput(recipe: RecipeInput, shuffleSeed: number | null = 1): MapInput {
  const ings: IngredientInput[] = [];
  for (const s of recipe.sections) {
    const seen = new Map<string, IngredientInput>();
    for (const i of s.ingredients) {
      const base: IngredientInput = {
        ...i,
        split_group_id: null,
        portion_label: null,
        group_label: s.title ?? null,
      };
      if (!i.split_group_id) {
        ings.push(base);
        continue;
      }
      const first = seen.get(i.split_group_id);
      if (!first) {
        const copy = { ...base, raw_text: null };
        seen.set(i.split_group_id, copy);
        ings.push(copy);
      } else {
        first.metric_qty = (first.metric_qty ?? 0) + (i.metric_qty ?? 0) || null;
        first.us_qty = (first.us_qty ?? 0) + (i.us_qty ?? 0) || null;
      }
    }
  }
  if (shuffleSeed !== null) {
    const r = rng(shuffleSeed);
    for (let i = ings.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [ings[i], ings[j]] = [ings[j]!, ings[i]!];
    }
  }
  return {
    ingredients: ings,
    steps: recipe.sections.flatMap((s) =>
      s.steps.map((st) => ({ text: st.detail, section: s.title ?? null })),
    ),
  };
}
