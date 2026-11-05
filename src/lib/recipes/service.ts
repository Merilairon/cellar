import type { Db } from '@/lib/db/connection';
import {
  copyRecipe,
  createRecipe,
  deleteRecipe,
  getRecipeFull,
  getRecipeRow,
  listRecipesForUser,
  replaceRecipe,
  setRecipeVisibility,
  type RecipeFull,
  type RecipeTree,
} from '@/lib/db/recipes';
import { validateRecipeGrid } from '@/lib/grid/validate';
import { canRead, canWrite } from './access';
import {
  recipeInputSchema,
  visibilityInputSchema,
  zodIssuesToErrors,
  type FieldError,
  type RecipeInput,
  type ViewMode,
} from './schemas';

export type Actor = { id: string; role: 'admin' | 'member' };

export type Failure =
  { ok: false; status: 404 | 403 } | { ok: false; status: 422; errors: FieldError[] };
type Result<T> = ({ ok: true } & T) | Failure;

/** Default view mode: grid only when there is at least one column step and every span is valid. */
export function defaultViewMode(input: Pick<RecipeInput, 'sections'>): ViewMode {
  const hasColumn = input.sections.some((s) => s.steps.some((st) => st.kind === 'column'));
  return hasColumn && validateRecipeGrid(input).errors.length === 0 ? 'grid' : 'list';
}

function composeRawText(i: RecipeInput['sections'][number]['ingredients'][number]): string {
  const measure =
    i.display_primary === 'us' ? [i.us_qty, i.us_unit] : [i.metric_qty, i.metric_unit];
  return [...measure, i.name].filter((x) => x != null && x !== '').join(' ');
}

export function toTree(input: RecipeInput, viewMode: ViewMode): RecipeTree {
  return {
    fields: {
      title: input.title,
      description: input.description ?? null,
      servings: input.servings ?? null,
      servingsLabel: input.servings_label ?? null,
      prepMinutes: input.prep_minutes ?? null,
      cookMinutes: input.cook_minutes ?? null,
      sourceUrl: input.source_url ?? null,
      sourceName: input.source_name ?? null,
      // undefined: DB default (private) on create, unchanged on update.
      visibility: input.visibility,
      viewMode,
    },
    sections: input.sections.map((s) => ({
      title: s.title ?? null,
      ingredients: s.ingredients.map((i) => ({
        name: i.name,
        note: i.note ?? null,
        rawText: i.raw_text ?? composeRawText(i),
        metricQty: i.metric_qty ?? null,
        metricUnit: i.metric_unit ?? null,
        usQty: i.us_qty ?? null,
        usUnit: i.us_unit ?? null,
        displayPrimary: i.display_primary,
        splitGroupId: i.split_group_id ?? null,
        portionLabel: i.portion_label ?? null,
        groupLabel: i.group_label ?? null,
      })),
      steps: s.steps.map((st) => ({
        kind: st.kind,
        label: st.label,
        detail: st.detail,
        rowStart: st.kind === 'column' ? (st.row_start ?? null) : null,
        rowEnd: st.kind === 'column' ? (st.row_end ?? null) : null,
        tempC: st.temp_c ?? null,
        tempF: st.temp_f ?? null,
        minutesMin: st.minutes_min ?? null,
        minutesMax: st.minutes_max ?? null,
      })),
    })),
  };
}

/** Validate a request body into a persistable tree, or 422 field errors. */
export function prepareRecipe(body: unknown): Result<{ tree: RecipeTree }> {
  const parsed = recipeInputSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 422, errors: zodIssuesToErrors(parsed.error) };
  const input = parsed.data;
  const viewMode = input.view_mode ?? defaultViewMode(input);
  if (viewMode === 'grid') {
    const { errors } = validateRecipeGrid(input);
    if (errors.length > 0) return { ok: false, status: 422, errors };
  }
  return { ok: true, tree: toTree(input, viewMode) };
}

export function toApiRecipe(r: RecipeFull, canEdit: boolean) {
  return {
    id: r.id,
    owner_id: r.ownerId,
    title: r.title,
    description: r.description,
    servings: r.servings,
    servings_label: r.servingsLabel,
    prep_minutes: r.prepMinutes,
    cook_minutes: r.cookMinutes,
    source_url: r.sourceUrl,
    source_name: r.sourceName,
    visibility: r.visibility,
    view_mode: r.viewMode,
    copied_from_id: r.copiedFromId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    can_edit: canEdit,
    sections: r.sections.map((s) => ({
      id: s.id,
      position: s.position,
      title: s.title,
      ingredients: s.ingredients.map((i) => ({
        id: i.id,
        position: i.position,
        name: i.name,
        note: i.note,
        raw_text: i.rawText,
        metric_qty: i.metricQty,
        metric_unit: i.metricUnit,
        us_qty: i.usQty,
        us_unit: i.usUnit,
        display_primary: i.displayPrimary,
        split_group_id: i.splitGroupId,
        portion_label: i.portionLabel,
        group_label: i.groupLabel,
      })),
      steps: s.steps.map((t) => ({
        id: t.id,
        position: t.position,
        kind: t.kind,
        label: t.label,
        detail: t.detail,
        row_start: t.rowStart,
        row_end: t.rowEnd,
        temp_c: t.tempC,
        temp_f: t.tempF,
        minutes_min: t.minutesMin,
        minutes_max: t.minutesMax,
      })),
    })),
  };
}
export type ApiRecipe = ReturnType<typeof toApiRecipe>;

export function listRecipes(db: Db, actor: Actor) {
  return listRecipesForUser(db, actor.id).map((r) => ({
    id: r.id,
    title: r.title,
    owner_id: r.ownerId,
    owner_display_name: r.ownerDisplayName,
    visibility: r.visibility,
    view_mode: r.viewMode,
    updated_at: r.updatedAt,
  }));
}

export function createRecipeFor(
  db: Db,
  actor: Actor,
  body: unknown,
): Result<{ recipe: ApiRecipe }> {
  const prepared = prepareRecipe(body);
  if (!prepared.ok) return prepared;
  const id = createRecipe(db, actor.id, prepared.tree);
  return { ok: true, recipe: toApiRecipe(getRecipeFull(db, id)!, true) };
}

export function getRecipeFor(db: Db, actor: Actor, id: string): Result<{ recipe: ApiRecipe }> {
  const r = getRecipeFull(db, id);
  if (!r || !canRead(actor, r)) return { ok: false, status: 404 };
  return { ok: true, recipe: toApiRecipe(r, canWrite(actor, r)) };
}

export function updateRecipeFor(
  db: Db,
  actor: Actor,
  id: string,
  body: unknown,
): Result<{ recipe: ApiRecipe }> {
  const row = getRecipeRow(db, id);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  if (!canWrite(actor, row)) return { ok: false, status: 403 };
  const prepared = prepareRecipe(body);
  if (!prepared.ok) return prepared;
  if (!replaceRecipe(db, id, prepared.tree)) return { ok: false, status: 404 };
  return { ok: true, recipe: toApiRecipe(getRecipeFull(db, id)!, true) };
}

export function deleteRecipeFor(db: Db, actor: Actor, id: string): Result<object> {
  const row = getRecipeRow(db, id);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  if (!canWrite(actor, row)) return { ok: false, status: 403 };
  deleteRecipe(db, id);
  return { ok: true };
}

export function setVisibilityFor(
  db: Db,
  actor: Actor,
  id: string,
  body: unknown,
): Result<{ visibility: 'private' | 'users' }> {
  const row = getRecipeRow(db, id);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  if (!canWrite(actor, row)) return { ok: false, status: 403 };
  const parsed = visibilityInputSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 422, errors: zodIssuesToErrors(parsed.error) };
  setRecipeVisibility(db, id, parsed.data.visibility);
  return { ok: true, visibility: parsed.data.visibility };
}

export function copyRecipeFor(db: Db, actor: Actor, id: string): Result<{ id: string }> {
  const row = getRecipeRow(db, id);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  const newId = copyRecipe(db, id, actor.id);
  if (!newId) return { ok: false, status: 404 };
  return { ok: true, id: newId };
}
