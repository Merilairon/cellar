import { z } from 'zod';
import {
  joinQtyRange,
  parseIngredientLine,
  toIngredientFields,
} from '@/lib/import/ingredient-parser';
import type { Draft } from '@/lib/import/normalize';
import { validateRecipeGrid, type GridIssue } from '@/lib/grid/validate';
import type { ApiSection } from '@/components/recipe/types';
import {
  recipeInputSchema,
  zodIssuesToErrors,
  type FieldError,
  type IngredientInput,
  type StepKind,
  type Visibility,
} from './schemas';

// Pure form state <-> API payload mapping (no react, no db). Spans are 1-based in the UI and
// 0-based on the wire.

export type RecipePayload = z.input<typeof recipeInputSchema>;

export type FormStep = {
  key: string;
  kind: StepKind;
  label: string;
  detail: string;
  /** 1-based, blank = unset. */
  rowStart: string;
  rowEnd: string;
  tempC: string;
  tempF: string;
  minutesMin: string;
  minutesMax: string;
};

export type FormSection = {
  key: string;
  title: string;
  /** One ingredient per line. */
  ingredientsText: string;
  steps: FormStep[];
  /** Stored ingredients this section was loaded with (round trip of split/group fields). */
  originals: IngredientInput[];
};

export type FormState = {
  title: string;
  description: string;
  servings: string;
  servingsLabel: string;
  prepMinutes: string;
  cookMinutes: string;
  sourceName: string;
  sourceUrl: string;
  visibility: Visibility;
  sections: FormSection[];
};

// Keys of rows that exist at first render are derived from their index (`s0`, `s0-t1`), the
// same on the server and in the browser. `nextKey` is for rows created in event handlers
// only (add step, add section); it must never run while rendering, because a module counter
// differs between the server process and the client and causes a hydration mismatch.
let counter = 0;
export const nextKey = (): string => `k${++counter}`;

export const emptyStep = (kind: StepKind = 'column'): FormStep => ({
  key: nextKey(),
  kind,
  label: '',
  detail: '',
  rowStart: '',
  rowEnd: '',
  tempC: '',
  tempF: '',
  minutesMin: '',
  minutesMax: '',
});

export const emptySection = (key: string = nextKey()): FormSection => ({
  key,
  title: '',
  ingredientsText: '',
  steps: [],
  originals: [],
});

export const emptyForm = (): FormState => ({
  title: '',
  description: '',
  servings: '',
  servingsLabel: '',
  prepMinutes: '',
  cookMinutes: '',
  sourceName: '',
  sourceUrl: '',
  visibility: 'private',
  sections: [emptySection('s0')],
});

type RecipeLike = {
  title: string;
  description: string | null;
  servings: number | null;
  servings_label: string | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  source_url: string | null;
  source_name: string | null;
  visibility: Visibility;
  sections: Array<{
    title: string | null;
    ingredients: Array<
      { position: number } & Omit<IngredientInput, 'display_primary'> & {
          display_primary: 'metric' | 'us';
        }
    >;
    steps: Array<{
      position: number;
      kind: StepKind;
      label: string;
      detail: string;
      row_start: number | null;
      row_end: number | null;
      temp_c: number | null;
      temp_f: number | null;
      minutes_min: number | null;
      minutes_max: number | null;
    }>;
  }>;
};

const str = (n: number | null | undefined): string => (n == null ? '' : String(n));

const byPosition = <T extends { position: number }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.position - b.position);

function originalFromApi(
  i: RecipeLike['sections'][number]['ingredients'][number],
): IngredientInput {
  return {
    name: i.name,
    note: i.note ?? null,
    raw_text: i.raw_text ?? null,
    metric_qty: i.metric_qty ?? null,
    metric_qty_max: i.metric_qty_max ?? null,
    metric_unit: i.metric_unit ?? null,
    us_qty: i.us_qty ?? null,
    us_qty_max: i.us_qty_max ?? null,
    us_unit: i.us_unit ?? null,
    display_primary: i.display_primary,
    split_group_id: i.split_group_id ?? null,
    portion_label: i.portion_label ?? null,
    group_label: i.group_label ?? null,
  };
}

const lineOf = (i: IngredientInput): string =>
  i.raw_text ??
  [
    i.metric_qty != null ? joinQtyRange(i.metric_qty, i.metric_qty_max) : null,
    i.metric_unit,
    i.us_qty != null ? joinQtyRange(i.us_qty, i.us_qty_max) : null,
    i.us_unit,
    i.name,
  ]
    .filter((x) => x != null)
    .join(' ');

export function formFromRecipe(r: RecipeLike): FormState {
  return {
    title: r.title,
    description: r.description ?? '',
    servings: str(r.servings),
    servingsLabel: r.servings_label ?? '',
    prepMinutes: str(r.prep_minutes),
    cookMinutes: str(r.cook_minutes),
    sourceName: r.source_name ?? '',
    sourceUrl: r.source_url ?? '',
    visibility: r.visibility,
    sections: r.sections.map((s, si) => {
      const originals = byPosition(s.ingredients).map(originalFromApi);
      return {
        key: `s${si}`,
        title: s.title ?? '',
        ingredientsText: originals.map(lineOf).join('\n'),
        originals,
        steps: byPosition(s.steps).map((t, ti) => ({
          key: `s${si}-t${ti}`,
          kind: t.kind,
          label: t.label,
          detail: t.detail,
          rowStart: t.row_start == null ? '' : String(t.row_start + 1),
          rowEnd: t.row_end == null ? '' : String(t.row_end + 1),
          tempC: str(t.temp_c),
          tempF: str(t.temp_f),
          minutesMin: str(t.minutes_min),
          minutesMax: str(t.minutes_max),
        })),
      };
    }),
  };
}

type DraftSections = Draft['sections'];

function formFromDraftSections(d: Draft, sections: DraftSections): FormState {
  return formFromRecipe({
    title: d.title,
    description: d.description ?? null,
    servings: d.servings ?? null,
    servings_label: d.servings_label ?? null,
    prep_minutes: d.prep_minutes ?? null,
    cook_minutes: d.cook_minutes ?? null,
    source_url: d.source_url ?? null,
    source_name: d.source_name ?? null,
    visibility: d.visibility ?? 'private',
    sections: sections.map((s) => ({
      title: s.title ?? null,
      ingredients: s.ingredients.map((i, position) => ({ ...i, position })),
      steps: s.steps.map((t, position) => ({
        position,
        kind: t.kind,
        label: t.label,
        detail: t.detail,
        row_start: t.kind === 'column' ? (t.row_start ?? null) : null,
        row_end: t.kind === 'column' ? (t.row_end ?? null) : null,
        temp_c: t.temp_c ?? null,
        temp_f: t.temp_f ?? null,
        minutes_min: t.minutes_min ?? null,
        minutes_max: t.minutes_max ?? null,
      })),
    })),
  });
}

/** Pre-fills the form from an import draft (list view: spans stay empty unless the draft has them). */
export function formFromDraft(d: Draft): FormState {
  return formFromDraftSections(d, d.sections);
}

/**
 * Form for one structure of the draft: `list` is the flat page-order sections, `grid` the
 * mapper's proposal (falls back to the list when there is no proposal). Spans go from 0-based
 * to 1-based strings.
 */
export function formFromDraftMode(d: Draft, mode: 'list' | 'grid'): FormState {
  return formFromDraftSections(d, mode === 'grid' && d.mapping ? d.mapping.sections : d.sections);
}

/** Same form with only `sections` replaced; every field outside sections is kept. */
export const withSections = (f: FormState, sections: FormSection[]): FormState => ({
  ...f,
  sections,
});

/** Content of the sections without row keys, to tell whether the user edited them. */
export const sectionsSignature = (sections: FormSection[]): string =>
  JSON.stringify(
    sections.map((s) => [
      s.title,
      s.ingredientsText,
      s.steps.map((t) => [
        t.kind,
        t.label,
        t.detail,
        t.rowStart,
        t.rowEnd,
        t.tempC,
        t.tempF,
        t.minutesMin,
        t.minutesMax,
      ]),
    ]),
  );

/**
 * Sections as the grid component takes them, built from the form as it is right now. Ids come
 * from row indexes (never a counter), so server and client render the same markup.
 */
export function formToPreviewSections(f: FormState): ApiSection[] {
  return f.sections.map((s, si) => ({
    id: `pv-s${si}`,
    position: si,
    title: s.title.trim() ? s.title : null,
    ingredients: buildIngredients(s.ingredientsText, s.originals).map((i, ii) => ({
      id: `pv-s${si}-i${ii}`,
      position: ii,
      name: i.name,
      note: i.note ?? null,
      raw_text: i.raw_text ?? i.name,
      metric_qty: i.metric_qty ?? null,
      metric_qty_max: i.metric_qty_max ?? null,
      metric_unit: i.metric_unit ?? null,
      us_qty: i.us_qty ?? null,
      us_qty_max: i.us_qty_max ?? null,
      us_unit: i.us_unit ?? null,
      display_primary: i.display_primary ?? 'metric',
      split_group_id: i.split_group_id ?? null,
      portion_label: i.portion_label ?? null,
      group_label: i.group_label ?? null,
    })),
    steps: s.steps.map((t, ti) => {
      const column = t.kind === 'column';
      const a = column ? num(t.rowStart) : null;
      const b = column ? num(t.rowEnd) : null;
      return {
        id: `pv-s${si}-t${ti}`,
        position: ti,
        kind: t.kind,
        label: t.label,
        detail: t.detail,
        row_start: a === null ? null : a - 1,
        row_end: b === null ? null : b - 1,
        temp_c: num(t.tempC),
        temp_f: num(t.tempF),
        minutes_min: num(t.minutesMin),
        minutes_max: num(t.minutesMax),
      };
    }),
  }));
}

/** Everything that stops the form from being a drawable, savable grid (spans must all be set). */
export function previewIssues(f: FormState): GridIssue[] {
  return validateRecipeGrid({
    sections: previewSectionsToGrid(formToPreviewSections(f)),
  }).errors;
}

const previewSectionsToGrid = (secs: ApiSection[]) =>
  secs.map((s) => ({
    ingredients: s.ingredients,
    steps: s.steps.map((t) => ({ kind: t.kind, row_start: t.row_start, row_end: t.row_end })),
  }));

/** Non-blank trimmed lines; blank lines are ignored, so row numbers count these. */
export const ingredientLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Parse each line. A line identical to a stored ingredient keeps all its stored fields
 * (including split group and portion label); an edited line is re-parsed and keeps only the
 * split/portion/group fields of the stored ingredient at the same row.
 */
export function buildIngredients(text: string, originals: IngredientInput[]): IngredientInput[] {
  const lines = ingredientLines(text);
  const used = new Set<number>();
  const exact: number[] = lines.map(() => -1);
  // Prefer the same row (identical lines, such as two sugar rows, stay in place), then any
  // unused stored ingredient with the same text.
  lines.forEach((line, row) => {
    if (originals[row] && lineOf(originals[row]).trim() === line) {
      exact[row] = row;
      used.add(row);
    }
  });
  lines.forEach((line, row) => {
    if (exact[row] >= 0) return;
    const idx = originals.findIndex((o, i) => !used.has(i) && lineOf(o).trim() === line);
    if (idx >= 0) {
      exact[row] = idx;
      used.add(idx);
    }
  });
  return lines.map((line, row) => {
    if (exact[row] >= 0) return { ...originals[exact[row]] };
    const f = toIngredientFields(parseIngredientLine(line));
    const keep = !used.has(row) ? originals[row] : undefined;
    return {
      name: f.name,
      note: f.note,
      raw_text: f.raw_text,
      metric_qty: f.metric_qty,
      metric_qty_max: f.metric_qty_max,
      metric_unit: f.metric_unit,
      us_qty: f.us_qty,
      us_qty_max: f.us_qty_max,
      us_unit: f.us_unit,
      display_primary: f.display_primary,
      split_group_id: keep?.split_group_id ?? null,
      portion_label: keep?.portion_label ?? null,
      group_label: keep?.group_label ?? null,
    };
  });
}

/** Blank -> null; a non-numeric value becomes -1 so the schema rejects it instead of dropping it. */
function num(s: string): number | null {
  const v = s.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : -1;
}

export function formToPayload(f: FormState): RecipePayload {
  return {
    title: f.title,
    description: f.description,
    servings: num(f.servings),
    servings_label: f.servingsLabel,
    prep_minutes: num(f.prepMinutes),
    cook_minutes: num(f.cookMinutes),
    source_name: f.sourceName,
    source_url: f.sourceUrl,
    visibility: f.visibility,
    sections: f.sections.map((s) => ({
      title: s.title,
      ingredients: buildIngredients(s.ingredientsText, s.originals),
      steps: s.steps.map((t) => {
        const base = {
          label: t.label,
          detail: t.detail,
          temp_c: num(t.tempC),
          temp_f: num(t.tempF),
          minutes_min: num(t.minutesMin),
          minutes_max: num(t.minutesMax),
        };
        if (t.kind !== 'column') return { kind: t.kind, ...base };
        const a = num(t.rowStart);
        const b = num(t.rowEnd);
        return {
          kind: 'column' as const,
          ...base,
          row_start: a === null ? null : a - 1,
          row_end: b === null ? null : b - 1,
        };
      }),
    })),
  };
}

/**
 * Same recipe as the API returned it, as a PUT payload (used by Convert to grid, which only
 * changes spans). `spans` maps a step id to 0-based [start, end].
 */
export function recipePayloadWithSpans(
  r: RecipeLike & { sections: Array<{ steps: Array<{ id: string }> }> },
  spans: Map<string, [number, number]>,
  viewMode: 'grid' | 'list',
): RecipePayload {
  return {
    title: r.title,
    description: r.description,
    servings: r.servings,
    servings_label: r.servings_label,
    prep_minutes: r.prep_minutes,
    cook_minutes: r.cook_minutes,
    source_url: r.source_url,
    source_name: r.source_name,
    visibility: r.visibility,
    view_mode: viewMode,
    sections: r.sections.map((s) => ({
      title: s.title,
      ingredients: byPosition(s.ingredients).map(originalFromApi),
      steps: byPosition(
        s.steps as Array<RecipeLike['sections'][number]['steps'][number] & { id: string }>,
      ).map((t) => {
        const base = {
          label: t.label,
          detail: t.detail,
          temp_c: t.temp_c,
          temp_f: t.temp_f,
          minutes_min: t.minutes_min,
          minutes_max: t.minutes_max,
        };
        if (t.kind !== 'column') return { kind: t.kind, ...base };
        const span = spans.get(t.id);
        return {
          kind: 'column' as const,
          ...base,
          row_start: span ? span[0] : t.row_start,
          row_end: span ? span[1] : t.row_end,
        };
      }),
    })),
  };
}

/** Grid error codes the form reports inline. Missing spans are fine: the recipe is saved as list. */
const SOFT_GRID_CODES = new Set(['span_required_for_grid', 'span_incomplete']);

export type ValidationResult =
  | { ok: true; payload: RecipePayload; viewMode: 'grid' | 'list' }
  | { ok: false; errors: FieldError[] };

/** Client-side validation with the shared schema plus span range checks. */
export function validateForm(f: FormState): ValidationResult {
  const payload = formToPayload(f);
  const parsed = recipeInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, errors: zodIssuesToErrors(parsed.error) };
  const grid = validateRecipeGrid(parsed.data);
  const hard = grid.errors.filter((e) => !SOFT_GRID_CODES.has(e.code));
  if (hard.length) return { ok: false, errors: hard };
  const hasColumn = parsed.data.sections.some((s) => s.steps.some((t) => t.kind === 'column'));
  return { ok: true, payload, viewMode: hasColumn && grid.errors.length === 0 ? 'grid' : 'list' };
}

/** First code per path (zod can report several issues on one field). */
export function errorMap(errors: FieldError[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of errors) if (!m.has(e.path)) m.set(e.path, e.code);
  return m;
}

const MESSAGE_KEYS: Record<string, string> = {
  too_small: 'recipe.errors.too_small',
  too_big: 'recipe.errors.too_big',
  invalid_type: 'recipe.errors.invalid_type',
  invalid_url: 'recipe.errors.invalid_url',
  minutes_order: 'recipe.errors.minutes_order',
  span_incomplete: 'recipe.errors.span_incomplete',
  span_required_for_grid: 'recipe.errors.span_required_for_grid',
  row_order: 'recipe.errors.row_order',
  row_out_of_range: 'recipe.errors.row_out_of_range',
  no_rows: 'recipe.errors.no_rows',
  banner_has_span: 'recipe.errors.banner_has_span',
  positions_not_contiguous: 'recipe.errors.generic',
  split_group_cross_section: 'recipe.errors.split_group_cross_section',
};
export const errorMessageKey = (code: string): string =>
  MESSAGE_KEYS[code] ?? 'recipe.errors.generic';
