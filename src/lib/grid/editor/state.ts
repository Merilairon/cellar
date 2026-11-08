// Editor document model, client keys (G4) and the API conversions. Pure and client-safe:
// no Date, Math.random, DOM, fetch, react or db imports.

import { createHistory, type History } from './history';

export const LIMITS = { sections: 20, ingredients: 200, steps: 100 } as const;

export type StepKind = 'banner_top' | 'column' | 'banner_bottom';
export type DisplayPrimary = 'metric' | 'us';

export type IngredientFields = {
  name: string;
  note: string | null;
  raw_text: string | null;
  metric_qty: number | null;
  metric_qty_max: number | null;
  metric_unit: string | null;
  us_qty: number | null;
  us_qty_max: number | null;
  us_unit: string | null;
  display_primary: DisplayPrimary;
  portion_label: string | null;
  group_label: string | null;
};

export type EditorIngredient = IngredientFields & {
  /** Client key: the server id at load, `new-<n>` for added rows. Stable across saves. */
  key: string;
  /** Split group key (server group id at load, `new-<n>` when created). Null when not split. */
  split_group: string | null;
};

export type StepFields = {
  label: string;
  detail: string;
  temp_c: number | null;
  temp_f: number | null;
  minutes_min: number | null;
  minutes_max: number | null;
};

export type EditorStep = StepFields & {
  key: string;
  kind: StepKind;
  row_start: number | null;
  row_end: number | null;
};

export type EditorSection = {
  key: string;
  title: string | null;
  ingredients: EditorIngredient[];
  /** Always in canonical order: banner_top, column, banner_bottom (rule 4 follows from kind). */
  steps: EditorStep[];
};

/** The part of the state that history snapshots. */
export type EditorDoc = { sections: EditorSection[] };

export type Selection = { stepKey: string | null; rowKey: string | null };

export type EditorNotice = { type: 'stepsRemoved'; stepKeys: string[]; labels: string[] };

export type EditorState = {
  history: History<EditorDoc>;
  /** Outside history. */
  selection: Selection;
  /** Outside history; describes the last action's side effect for announcements. */
  notice: EditorNotice | null;
  /** Deterministic client-key counter; never decremented (so undo cannot reuse a key). */
  nextKey: number;
};

export const doc = (s: EditorState): EditorDoc => s.history.present;

// ---- API shapes (structural, so this module needs no service imports) -------------------

export type ApiIngredientLike = Partial<IngredientFields> & {
  id?: string | null;
  name: string;
  split_group_id?: string | null;
};
export type ApiStepLike = Partial<StepFields> & {
  id?: string | null;
  kind: StepKind;
  label: string;
  row_start?: number | null;
  row_end?: number | null;
};
export type ApiSectionLike = {
  id?: string | null;
  title?: string | null;
  ingredients: ApiIngredientLike[];
  steps: ApiStepLike[];
};
export type ApiRecipeLike = { updated_at?: string; sections: ApiSectionLike[] };

export const STEP_RANK: Record<StepKind, number> = { banner_top: 0, column: 1, banner_bottom: 2 };

/** Stable sort into banner_top, column, banner_bottom order (array order inside a kind is kept). */
export function canonicalSteps(steps: EditorStep[]): EditorStep[] {
  const sorted = steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => STEP_RANK[a.s.kind] - STEP_RANK[b.s.kind] || a.i - b.i)
    .map((x) => x.s);
  return sorted.every((s, i) => s === steps[i]) ? steps : sorted;
}

export const newKey = (n: number) => `new-${n}`;

/** Build editor state from an API recipe (or any sample with the same shape). Ids become keys. */
export function fromApiRecipe(recipe: ApiRecipeLike): EditorState {
  let n = 1;
  const keyFor = (id: string | null | undefined) => (id ? id : newKey(n++));
  const sections: EditorSection[] = recipe.sections.map((s) => ({
    key: keyFor(s.id),
    title: s.title ?? null,
    ingredients: s.ingredients.map((i) => ({
      key: keyFor(i.id),
      name: i.name,
      note: i.note ?? null,
      raw_text: i.raw_text ?? null,
      metric_qty: i.metric_qty ?? null,
      metric_qty_max: i.metric_qty_max ?? null,
      metric_unit: i.metric_unit ?? null,
      us_qty: i.us_qty ?? null,
      us_qty_max: i.us_qty_max ?? null,
      us_unit: i.us_unit ?? null,
      display_primary: i.display_primary ?? 'metric',
      split_group: i.split_group_id ?? null,
      portion_label: i.portion_label ?? null,
      group_label: i.group_label ?? null,
    })),
    steps: canonicalSteps(
      s.steps.map((t) => ({
        key: keyFor(t.id),
        kind: t.kind,
        label: t.label,
        detail: t.detail ?? '',
        row_start: t.kind === 'column' ? (t.row_start ?? null) : null,
        row_end: t.kind === 'column' ? (t.row_end ?? null) : null,
        temp_c: t.temp_c ?? null,
        temp_f: t.temp_f ?? null,
        minutes_min: t.minutes_min ?? null,
        minutes_max: t.minutes_max ?? null,
      })),
    ),
  }));
  return {
    history: createHistory({ sections }),
    selection: { stepKey: null, rowKey: null },
    notice: null,
    nextKey: n,
  };
}

// ---- Payload (PUT /api/recipes/:id/grid body) -------------------------------------------

export type GridPayloadIngredient = IngredientFields & { split_group_id: string | null };
export type GridPayloadStep = StepFields & {
  kind: StepKind;
  row_start: number | null;
  row_end: number | null;
};
export type GridPayloadSection = {
  title: string | null;
  ingredients: GridPayloadIngredient[];
  steps: GridPayloadStep[];
};
export type GridPayload = { base_updated_at: string; sections: GridPayloadSection[] };

export function docToPayloadSections(d: EditorDoc): GridPayloadSection[] {
  return d.sections.map((s) => ({
    title: s.title,
    // Arrays in order only: no ids, no positions (G5). The server rewrites split group ids.
    ingredients: s.ingredients.map((i) => ({
      name: i.name,
      note: i.note,
      raw_text: i.raw_text,
      metric_qty: i.metric_qty,
      metric_qty_max: i.metric_qty_max,
      metric_unit: i.metric_unit,
      us_qty: i.us_qty,
      us_qty_max: i.us_qty_max,
      us_unit: i.us_unit,
      display_primary: i.display_primary,
      split_group_id: i.split_group,
      portion_label: i.portion_label,
      group_label: i.group_label,
    })),
    steps: s.steps.map((t) => ({
      kind: t.kind,
      label: t.label,
      detail: t.detail,
      row_start: t.kind === 'column' ? t.row_start : null,
      row_end: t.kind === 'column' ? t.row_end : null,
      temp_c: t.temp_c,
      temp_f: t.temp_f,
      minutes_min: t.minutes_min,
      minutes_max: t.minutes_max,
    })),
  }));
}

export function toGridPayload(state: EditorState, baseUpdatedAt: string): GridPayload {
  return { base_updated_at: baseUpdatedAt, sections: docToPayloadSections(doc(state)) };
}
