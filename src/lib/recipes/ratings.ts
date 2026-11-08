import { z } from 'zod';
import type { Db } from '@/lib/db/connection';
import { deleteRating, ratingSummary, upsertRating, type RatingSummary } from '@/lib/db/ratings';
import { getRecipeRow, RecipeGuardError, type RecipeGuard } from '@/lib/db/recipes';
import { canRead } from './access';
import { zodIssuesToErrors, type FieldError } from './schemas';
import type { Actor } from './service';

/** Rating bodies are tiny: `{"stars":5}`. */
export const RATING_BODY_MAX = 1024;

type Failure = { ok: false; status: 404 } | { ok: false; status: 422; errors: FieldError[] };

// strictObject: user_id (or anything else) from the client is rejected, never read.
export const ratingSchema = z.strictObject({ stars: z.number().int().min(1).max(5) });

export type ApiRating = {
  rating_avg: number | null;
  rating_count: number;
  my_rating: number | null;
};

export const toApiRating = (s: RatingSummary): ApiRating => ({
  rating_avg: s.avg,
  rating_count: s.count,
  my_rating: s.mine,
});

// Any reader may rate (Q3), including their own recipe and a read-only `users` recipe.
const readGuard =
  (actor: Actor): RecipeGuard =>
  (row) =>
    canRead(actor, row) ? 'ok' : 'not_found';

function guarded<T>(fn: () => T): { ok: true; value: T } | { ok: false; status: 404 } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof RecipeGuardError) return { ok: false, status: 404 };
    throw e;
  }
}

export function setRatingFor(
  db: Db,
  actor: Actor,
  recipeId: string,
  body: unknown,
): { ok: true; rating: ApiRating } | Failure {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  const parsed = ratingSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 422, errors: zodIssuesToErrors(parsed.error) };
  }
  const res = guarded(() =>
    upsertRating(db, recipeId, actor.id, parsed.data.stars, readGuard(actor)),
  );
  if (!res.ok || !res.value) return { ok: false, status: 404 };
  return { ok: true, rating: toApiRating(ratingSummary(db, recipeId, actor.id)) };
}

export function clearRatingFor(
  db: Db,
  actor: Actor,
  recipeId: string,
): { ok: true } | { ok: false; status: 404 } {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  const res = guarded(() => deleteRating(db, recipeId, actor.id, readGuard(actor)));
  return res.ok && res.value ? { ok: true } : { ok: false, status: 404 };
}
