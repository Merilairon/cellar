import { z } from 'zod';
import { MAX_TAGS_PER_RECIPE, normalizeTagName } from '@/lib/recipes/tag-name';

// Backup format v1 (docs/tasks/v1.0-tasklist.md T9, G13, R6, R7, R12). Pure: no node, db, fs
// or network imports. Every object is strict (unknown keys are rejected), no row ids appear
// anywhere (R6), and every array and string has a cap so a hostile file is bounded before any
// loop over it runs.

export const BACKUP_VERSION = 1 as const;

// 5 000 recipes of the fixture shape serialise to about 23 MiB (scripts/export-sizes.ts: 4.84 MB
// per 1 000), under the 32 MiB manifest cap in unzip.ts. Export refuses to exceed that cap.
export const MAX_RECIPES = 5000;
// Per-recipe limits are the ones the recipe form enforces (recipeInputSchema: 20 sections, 200
// ingredients and 100 steps per section, 20 tags), so a file the preview accepts cannot produce
// a recipe the edit form rejects on every save.
export const MAX_SECTIONS = 20;
export const MAX_INGREDIENTS_PER_SECTION = 200;
export const MAX_STEPS_PER_SECTION = 100;
export const MAX_NOTES_PER_RECIPE = 200;
export const MAX_PHOTOS_PER_RECIPE = 10;
export { MAX_TAGS_PER_RECIPE };
export const MAX_RATINGS_PER_RECIPE = 1000;
export const MAX_USERS = 1000;
/** Sum of ingredients, steps, notes and ratings in one document (checked before zod). */
export const MAX_TOTAL_ROWS = 250_000;
const MAX_DOC_ISSUES = 50;

/** Archive entry name of a photo file; also the only shape accepted in `file` and `thumb`. */
export const PHOTO_PATH_RE = /^photos\/[0-9A-HJKMNP-TV-Z]{26}\.webp$/;

const str = (max: number) => z.string().max(max);
const nstr = (max: number) => z.string().max(max).nullable();
const nonNegInt = (max: number) => z.number().int().min(0).max(max);
const nonNegNum = z.number().finite().min(0).max(1_000_000);
const stamp = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/, 'invalid_timestamp')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid_timestamp');
const email = z
  .string()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+$/, 'invalid_email')
  // The app stores emails lowercased and identity checks compare exact strings.
  .refine((v) => v === v.toLowerCase(), 'email_not_lowercase');
// Bounded raw length, then the app's own tag rules (the same normalizeTagName the tag table
// goes through), so an unusable tag is a preview error and not a failure at recipe k.
const tagName = z
  .string()
  .max(160)
  .refine((v) => normalizeTagName(v) !== null, 'invalid_tag');
const photoPath = z.string().max(64).regex(PHOTO_PATH_RE, 'invalid_photo_path');

export const backupIngredientSchema = z
  .strictObject({
    position: nonNegInt(10_000),
    name: str(200).min(1),
    note: nstr(300),
    raw_text: str(500),
    metric_qty: nonNegNum.nullable(),
    metric_qty_max: nonNegNum.nullable(),
    metric_unit: nstr(20),
    us_qty: nonNegNum.nullable(),
    us_qty_max: nonNegNum.nullable(),
    us_unit: nstr(20),
    display_primary: z.enum(['metric', 'us']),
    /** Per-recipe local key shared by the rows of one split ingredient (not the stored ULID). */
    split_group_key: nstr(64),
    portion_label: nstr(60),
    group_label: nstr(120),
  })
  .superRefine((v, ctx) => {
    for (const side of ['metric', 'us'] as const) {
      const lo = v[`${side}_qty`];
      const hi = v[`${side}_qty_max`];
      if (hi !== null && (lo === null || hi <= lo)) {
        ctx.addIssue({ code: 'custom', message: 'qty_range_order', path: [`${side}_qty_max`] });
      }
    }
  });

export const backupStepSchema = z
  .strictObject({
    position: nonNegInt(10_000),
    kind: z.enum(['banner_top', 'column', 'banner_bottom']),
    label: str(80).min(1),
    detail: str(4000),
    row_start: nonNegInt(10_000).nullable(),
    row_end: nonNegInt(10_000).nullable(),
    temp_c: nonNegInt(1000).nullable(),
    temp_f: nonNegInt(2000).nullable(),
    minutes_min: nonNegInt(100_000).nullable(),
    minutes_max: nonNegInt(100_000).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.minutes_min !== null && v.minutes_max !== null && v.minutes_min > v.minutes_max) {
      ctx.addIssue({ code: 'custom', message: 'minutes_order', path: ['minutes_max'] });
    }
    // Mirrors the step_span_chk CHECK: banners carry no span, a column has both or neither.
    if (v.kind !== 'column') {
      if (v.row_start !== null || v.row_end !== null) {
        ctx.addIssue({ code: 'custom', message: 'span_on_banner', path: ['row_start'] });
      }
    } else if ((v.row_start === null) !== (v.row_end === null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'span_incomplete',
        path: [v.row_start === null ? 'row_start' : 'row_end'],
      });
    } else if (v.row_start !== null && v.row_end !== null && v.row_start > v.row_end) {
      ctx.addIssue({ code: 'custom', message: 'row_order', path: ['row_end'] });
    }
  });

/** `position` must equal the array index: restore assigns positions by index, so a gap is a lie. */
function contiguous(
  items: Array<{ position: number }>,
  ctx: z.RefinementCtx,
  base: (string | number)[],
) {
  // One issue at most per list: a hostile list must not mint thousands of issues.
  const i = items.findIndex((it, n) => it.position !== n);
  if (i >= 0) {
    ctx.addIssue({ code: 'custom', message: 'position_mismatch', path: [...base, i, 'position'] });
  }
}

export const backupSectionSchema = z
  .strictObject({
    position: nonNegInt(10_000),
    title: nstr(120),
    ingredients: z.array(backupIngredientSchema).max(MAX_INGREDIENTS_PER_SECTION),
    steps: z.array(backupStepSchema).max(MAX_STEPS_PER_SECTION),
  })
  .superRefine((v, ctx) => {
    contiguous(v.ingredients, ctx, ['ingredients']);
    contiguous(v.steps, ctx, ['steps']);
  });

export const backupPhotoSchema = z.strictObject({
  position: nonNegInt(10_000),
  is_cover: z.boolean(),
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
  file: photoPath,
  /** Null for rows that predate thumbnails (0007). */
  thumb: photoPath.nullable(),
});

export const backupNoteSchema = z.strictObject({
  body: str(4000).min(1),
  shared: z.boolean(),
  author_display_name: str(80).min(1),
  /** `all` scope only. */
  author_email: email.optional(),
  /** `own` scope only: true when the exporting user wrote the note. */
  mine: z.boolean().optional(),
  created_at: stamp,
  updated_at: stamp,
});

export const backupRatingSchema = z.strictObject({
  stars: z.number().int().min(1).max(5),
  /** `all` scope only. */
  user_email: email.optional(),
  created_at: stamp,
  updated_at: stamp,
});

export const backupRecipeSchema = z
  .strictObject({
    title: str(200).min(1),
    description: nstr(5000),
    servings: z.number().finite().positive().max(10_000).nullable(),
    servings_label: nstr(60),
    prep_minutes: nonNegInt(100_000).nullable(),
    cook_minutes: nonNegInt(100_000).nullable(),
    source_url: nstr(2000),
    source_name: nstr(200),
    visibility: z.enum(['private', 'users']),
    view_mode: z.enum(['grid', 'list']),
    /** `all` scope only. */
    owner_email: email.optional(),
    created_at: stamp,
    updated_at: stamp,
    tags: z.array(tagName).max(MAX_TAGS_PER_RECIPE),
    sections: z.array(backupSectionSchema).min(1).max(MAX_SECTIONS),
    photos: z.array(backupPhotoSchema).max(MAX_PHOTOS_PER_RECIPE),
    notes: z.array(backupNoteSchema).max(MAX_NOTES_PER_RECIPE),
    ratings: z.array(backupRatingSchema).max(MAX_RATINGS_PER_RECIPE),
  })
  .superRefine((v, ctx) => {
    contiguous(v.sections, ctx, ['sections']);
    contiguous(v.photos, ctx, ['photos']);
    if (v.photos.filter((p) => p.is_cover).length > 1) {
      ctx.addIssue({ code: 'custom', message: 'multiple_covers', path: ['photos'] });
    }
    if (v.source_url !== null) {
      let ok = false;
      try {
        const p = new URL(v.source_url).protocol;
        ok = p === 'http:' || p === 'https:';
      } catch {
        ok = false;
      }
      if (!ok) ctx.addIssue({ code: 'custom', message: 'invalid_url', path: ['source_url'] });
    }
    if (v.view_mode === 'grid') {
      outer: for (let si = 0; si < v.sections.length; si++) {
        const steps = v.sections[si].steps;
        for (let ti = 0; ti < steps.length; ti++) {
          if (steps[ti].kind === 'column' && steps[ti].row_start === null) {
            ctx.addIssue({
              code: 'custom',
              message: 'span_required_for_grid',
              path: ['sections', si, 'steps', ti, 'row_start'],
            });
            break outer;
          }
        }
      }
    }
  });

export const backupUserSchema = z.strictObject({
  email,
  display_name: str(80).min(1),
  role: z.enum(['admin', 'member']),
  unit_pref: z.enum(['metric', 'us']),
  locale: str(20).min(1),
});

export const backupV1Schema = z
  .strictObject({
    version: z.literal(BACKUP_VERSION),
    exported_at: stamp,
    app_version: str(64),
    scope: z.enum(['own', 'all']),
    /** `all` scope only. */
    users: z.array(backupUserSchema).max(MAX_USERS).optional(),
    recipes: z.array(backupRecipeSchema).max(MAX_RECIPES),
    /** Zip exports only: photo files that were referenced but missing on disk and left out. */
    photos_missing: z.number().int().min(0).max(100_000).optional(),
  })
  .superRefine((doc, ctx) => {
    // Bounded: a hostile document must not make zod collect millions of issues.
    let issues = 0;
    const bad = (path: (string | number)[], message: string) => {
      if (issues++ < MAX_DOC_ISSUES) ctx.addIssue({ code: 'custom', message, path });
    };
    if (doc.scope === 'own') {
      if (doc.users !== undefined) bad(['users'], 'users_not_allowed');
    } else if (doc.users === undefined) {
      bad(['users'], 'users_required');
    }
    const emails = new Set<string>();
    for (const u of doc.users ?? []) {
      if (emails.has(u.email)) bad(['users'], 'duplicate_user_email');
      emails.add(u.email);
    }
    const files = new Set<string>();
    doc.recipes.forEach((r, ri) => {
      const at = (...p: (string | number)[]) => ['recipes', ri, ...p];
      if (doc.scope === 'own') {
        if (r.owner_email !== undefined) bad(at('owner_email'), 'not_allowed_in_own_scope');
        r.notes.forEach((n, i) => {
          if (n.author_email !== undefined)
            bad(at('notes', i, 'author_email'), 'not_allowed_in_own_scope');
          if (n.mine === undefined) bad(at('notes', i, 'mine'), 'required_in_own_scope');
        });
        r.ratings.forEach((x, i) => {
          if (x.user_email !== undefined)
            bad(at('ratings', i, 'user_email'), 'not_allowed_in_own_scope');
        });
        if (r.ratings.length > 1) bad(at('ratings'), 'one_rating_in_own_scope');
      } else {
        const known = (e: string | undefined, path: (string | number)[]) => {
          if (e === undefined) bad(path, 'required_in_all_scope');
          else if (!emails.has(e)) bad(path, 'unknown_user');
        };
        known(r.owner_email, at('owner_email'));
        r.notes.forEach((n, i) => {
          known(n.author_email, at('notes', i, 'author_email'));
          if (n.mine !== undefined) bad(at('notes', i, 'mine'), 'not_allowed_in_all_scope');
        });
        const raters = new Set<string>();
        r.ratings.forEach((x, i) => {
          known(x.user_email, at('ratings', i, 'user_email'));
          if (x.user_email !== undefined) {
            if (raters.has(x.user_email)) bad(at('ratings', i, 'user_email'), 'duplicate_rating');
            raters.add(x.user_email);
          }
        });
      }
      r.photos.forEach((p, i) => {
        for (const f of [p.file, p.thumb]) {
          if (f === null) continue;
          if (files.has(f)) bad(at('photos', i), 'duplicate_photo_file');
          files.add(f);
        }
      });
    });
  });

export type BackupV1 = z.output<typeof backupV1Schema>;
export type BackupRecipe = z.output<typeof backupRecipeSchema>;
export type BackupSection = z.output<typeof backupSectionSchema>;
export type BackupIngredient = z.output<typeof backupIngredientSchema>;
export type BackupStep = z.output<typeof backupStepSchema>;
export type BackupPhoto = z.output<typeof backupPhotoSchema>;
export type BackupNote = z.output<typeof backupNoteSchema>;
export type BackupRating = z.output<typeof backupRatingSchema>;
export type BackupUser = z.output<typeof backupUserSchema>;

export type BackupError = { path: string; code: string };

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Cheap length check over the raw (unvalidated) document, run before zod. It reads only
 * `.length` of arrays (never iterates a list longer than its cap), so a document claiming
 * millions of recipes is refused in O(1) and a hostile one costs at most the cap in steps.
 */
export function checkCaps(raw: unknown): BackupError[] {
  const errs: BackupError[] = [];
  if (!isObj(raw)) return errs;
  const over = (v: unknown, max: number, path: string, code: string): v is unknown[] => {
    if (!isArr(v)) return false;
    if (v.length > max) {
      errs.push({ path, code });
      return false;
    }
    return true;
  };
  if (isArr(raw.users)) over(raw.users, MAX_USERS, 'users', 'too_many_users');
  if (!over(raw.recipes, MAX_RECIPES, 'recipes', 'too_many_recipes')) return errs;
  const recipes = raw.recipes as unknown[];
  let total = 0;
  const count = (v: unknown) => {
    if (isArr(v)) total += v.length;
  };
  for (let ri = 0; ri < recipes.length && errs.length < 20; ri++) {
    const r = recipes[ri];
    if (!isObj(r)) continue;
    const p = `recipes.${ri}`;
    count(r.notes);
    count(r.ratings);
    over(r.notes, MAX_NOTES_PER_RECIPE, `${p}.notes`, 'too_many_notes');
    over(r.photos, MAX_PHOTOS_PER_RECIPE, `${p}.photos`, 'too_many_photos');
    over(r.tags, MAX_TAGS_PER_RECIPE, `${p}.tags`, 'too_many_tags');
    over(r.ratings, MAX_RATINGS_PER_RECIPE, `${p}.ratings`, 'too_many_ratings');
    if (over(r.sections, MAX_SECTIONS, `${p}.sections`, 'too_many_sections')) {
      (r.sections as unknown[]).forEach((s, si) => {
        if (!isObj(s)) return;
        count(s.ingredients);
        count(s.steps);
        over(
          s.ingredients,
          MAX_INGREDIENTS_PER_SECTION,
          `${p}.sections.${si}.ingredients`,
          'too_many_ingredients',
        );
        over(s.steps, MAX_STEPS_PER_SECTION, `${p}.sections.${si}.steps`, 'too_many_steps');
      });
    }
  }
  if (total > MAX_TOTAL_ROWS) errs.push({ path: 'recipes', code: 'too_large' });
  return errs;
}
