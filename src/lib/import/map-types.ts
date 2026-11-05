// Contract of the auto-mapper (data-model §3). Types only, plus the hard input caps.
// Pure module: no node, db or react imports.

import type { IngredientInput, RecipeInput } from '@/lib/recipes/schemas';

/** Hard caps applied at mapper entry, before any work (tasklist G10). */
export const MAP_LIMITS = {
  ingredients: 200,
  steps: 100,
  stepChars: 4000,
  ingredientNameChars: 200,
  totalStepChars: 120_000,
  tokensPerStep: 800,
  sections: 6,
  /** Deterministic operation budget (token comparisons and candidate checks). */
  budget: 2_000_000,
} as const;

export type MapStepInput = { text: string; section: string | null };

export type MapInput = {
  /** Parsed ingredients in page order. `group_label` carries ingredient group headings. */
  ingredients: IngredientInput[];
  /** Steps in page order; `section` is a HowToSection name or null. */
  steps: MapStepInput[];
};

/** Closed set of warning codes. Codes with a suffix carry data (rendered as text only). */
export type MappingWarning =
  | `ingredient_unmentioned:${string}`
  | `ambiguous_name:${string}`
  | `split_unresolved:${string}`
  | 'group_reference'
  | 'step_without_ingredients'
  | 'sections_from_ingredients_only'
  | 'section_merged'
  | 'ingredient_shared_across_sections'
  | 'too_many_sections'
  | 'input_truncated'
  | 'time_ambiguous'
  | 'mapping_invalid'
  | 'mapping_budget'
  | 'mapping_too_large'
  /** Number of data-carrying warnings left out of the list (see `Warnings`). */
  | `warnings_more:${number}`;

export type MappingLevel = 'high' | 'medium' | 'low';

/** Counted signals behind the confidence score (tasklist "Confidence scoring"). */
export type MappingSignals = {
  /** matched ingredients / total ingredients */
  cov: number;
  unamb: number;
  verbs: number;
  splitOk: number;
  secFactor: number;
  groupRefs: number;
  columnSteps: number;
  /** Number of distinct (section, `row_end`) pairs over all column steps. */
  distinctSpans: number;
};

export type MappingProposal = {
  confidence: number;
  level: MappingLevel;
  sections: RecipeInput['sections'];
  warnings: MappingWarning[];
  signals: MappingSignals;
  version: 1;
};

export type MapFailureReason = 'empty' | 'budget' | 'invalid' | 'too_many_sections' | 'error';

export type MapResult =
  | { mapped: true; proposal: MappingProposal }
  | { mapped: false; reason: MapFailureReason; warnings: MappingWarning[] };

export type MapOptions = {
  /** Lowers the operation budget; values above `MAP_LIMITS.budget` are clamped to it. */
  budget?: number;
  /** Test/diagnostic hook: receives the operations counted, also on failure. */
  onUsed?: (used: number) => void;
};
