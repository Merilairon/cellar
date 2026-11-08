import { z } from 'zod';
import { MAX_TAGS_PER_RECIPE, normalizeTagName } from './tag-name';

// Shared by client and server: no node, db or react imports here.

export const visibilitySchema = z.enum(['private', 'users']);
export const viewModeSchema = z.enum(['grid', 'list']);
export const stepKindSchema = z.enum(['banner_top', 'column', 'banner_bottom']);
export const displayPrimarySchema = z.enum(['metric', 'us']);

export type Visibility = z.infer<typeof visibilitySchema>;
export type ViewMode = z.infer<typeof viewModeSchema>;
export type StepKind = z.infer<typeof stepKindSchema>;

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), text(max).nullish());
const nonNegInt = (max: number) => z.number().int().min(0).max(max);
const nonNegNum = z.number().finite().min(0).max(1_000_000);

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const p = new URL(v).protocol;
      return p === 'http:' || p === 'https:';
    } catch {
      return false;
    }
  }, 'invalid_url');

// Normalizes (trim, whitespace, NFC, lowercase); a name that cannot be a tag is a field error.
const tagName = z.string().transform((v, ctx) => {
  const n = normalizeTagName(v);
  if (n === null) {
    ctx.addIssue({ code: 'custom', message: 'invalid_tag' });
    return z.NEVER;
  }
  return n;
});

export const ingredientInputSchema = z
  .object({
    name: text(200).min(1),
    note: optText(300),
    raw_text: optText(500),
    metric_qty: nonNegNum.nullish(),
    metric_qty_max: nonNegNum.nullish(),
    metric_unit: optText(20),
    us_qty: nonNegNum.nullish(),
    us_qty_max: nonNegNum.nullish(),
    us_unit: optText(20),
    display_primary: displayPrimarySchema.default('metric'),
    // Client-chosen opaque value; rewritten to fresh ULIDs on write.
    split_group_id: optText(64),
    portion_label: optText(60),
    group_label: optText(120),
  })
  .superRefine((v, ctx) => {
    for (const side of ['metric', 'us'] as const) {
      const lo = v[`${side}_qty`];
      const hi = v[`${side}_qty_max`];
      if (hi != null && (lo == null || hi <= lo)) {
        ctx.addIssue({ code: 'custom', message: 'qty_range_order', path: [`${side}_qty_max`] });
      }
    }
  });

const spanFields = {
  label: text(80).min(1),
  detail: text(4000).default(''),
  temp_c: nonNegInt(1000).nullish(),
  temp_f: nonNegInt(2000).nullish(),
  minutes_min: nonNegInt(100_000).nullish(),
  minutes_max: nonNegInt(100_000).nullish(),
};

const timeOrder = (
  v: { minutes_min?: number | null; minutes_max?: number | null },
  ctx: z.RefinementCtx,
) => {
  if (v.minutes_min != null && v.minutes_max != null && v.minutes_min > v.minutes_max) {
    ctx.addIssue({ code: 'custom', message: 'minutes_order', path: ['minutes_max'] });
  }
};

const bannerStep = (kind: 'banner_top' | 'banner_bottom') =>
  z
    .object({
      kind: z.literal(kind),
      ...spanFields,
      row_start: z.null().optional(),
      row_end: z.null().optional(),
    })
    .superRefine(timeOrder);

const columnStep = z
  .object({
    kind: z.literal('column'),
    ...spanFields,
    row_start: nonNegInt(10_000).nullish(),
    row_end: nonNegInt(10_000).nullish(),
  })
  .superRefine((v, ctx) => {
    timeOrder(v, ctx);
    const s = v.row_start ?? null;
    const e = v.row_end ?? null;
    if ((s === null) !== (e === null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'span_incomplete',
        path: [s === null ? 'row_start' : 'row_end'],
      });
    } else if (s !== null && e !== null && s > e) {
      ctx.addIssue({ code: 'custom', message: 'row_order', path: ['row_end'] });
    }
  });

export const stepInputSchema = z.discriminatedUnion('kind', [
  bannerStep('banner_top'),
  columnStep,
  bannerStep('banner_bottom'),
]);

export const sectionInputSchema = z.object({
  title: optText(120),
  ingredients: z.array(ingredientInputSchema).max(200),
  steps: z.array(stepInputSchema).max(100),
});

export const recipeInputSchema = z
  .object({
    title: text(200).min(1),
    description: optText(5000),
    servings: z.number().finite().positive().max(10_000).nullish(),
    servings_label: optText(60),
    prep_minutes: nonNegInt(100_000).nullish(),
    cook_minutes: nonNegInt(100_000).nullish(),
    source_url: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      httpUrl.nullish(),
    ),
    source_name: optText(200),
    visibility: visibilitySchema.optional(),
    view_mode: viewModeSchema.optional(),
    sections: z.array(sectionInputSchema).min(1).max(20),
    // Omitted: keep stored tags on update, none on create. [] clears. Deduped after normalizing.
    tags: z
      .array(tagName)
      .max(MAX_TAGS_PER_RECIPE)
      .transform((t) => [...new Set(t)])
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.view_mode !== 'grid') return;
    v.sections.forEach((sec, si) =>
      sec.steps.forEach((st, ti) => {
        if (st.kind === 'column' && (st.row_start == null || st.row_end == null)) {
          ctx.addIssue({
            code: 'custom',
            message: 'span_required_for_grid',
            path: ['sections', si, 'steps', ti, st.row_start == null ? 'row_start' : 'row_end'],
          });
        }
      }),
    );
  });

/** Body of PUT /api/recipes/:id/grid. Strict: recipe fields, tags and ids are rejected, not ignored. */
export const gridInputSchema = z
  .object({
    base_updated_at: z
      .string()
      .max(40)
      .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid_timestamp'),
    sections: z.array(sectionInputSchema).min(1).max(20),
  })
  .strict();

export const visibilityInputSchema = z.object({ visibility: visibilitySchema });

export type IngredientInput = z.output<typeof ingredientInputSchema>;
export type StepInput = z.output<typeof stepInputSchema>;
export type SectionInput = z.output<typeof sectionInputSchema>;
export type RecipeInput = z.output<typeof recipeInputSchema>;

export type FieldError = { path: string; code: string };

/** Flatten zod issues to the API's `{ path, code }` shape (custom issues carry their code as message). */
export function zodIssuesToErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((i) => ({
    path: i.path.map(String).join('.'),
    code: i.code === 'custom' ? i.message : i.code,
  }));
}
