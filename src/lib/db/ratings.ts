import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './connection';
import { RecipeGuardError, type RecipeGuard } from './recipes';
import { nowIso, rating, recipe } from './schema';

export type RatingSummary = {
  /** Stored (unrounded) average over all raters, null when nobody rated. */
  avg: number | null;
  count: number;
  /** The caller's own rating, null when none. */
  mine: number | null;
};

/** Average, count and the caller's own stars for one recipe. Other raters are never exposed. */
export function ratingSummary(db: Db, recipeId: string, me: string): RatingSummary {
  const agg = db
    .select({ avg: sql<number | null>`avg(${rating.stars})`, count: sql<number>`count(*)` })
    .from(rating)
    .where(eq(rating.recipeId, recipeId))
    .get()!;
  const mine = db
    .select({ stars: rating.stars })
    .from(rating)
    .where(and(eq(rating.recipeId, recipeId), eq(rating.userId, me)))
    .get();
  return { avg: agg.avg, count: agg.count, mine: mine?.stars ?? null };
}

function enforce(guard: RecipeGuard | undefined, row: typeof recipe.$inferSelect): void {
  const verdict = guard ? guard(row) : 'ok';
  if (verdict !== 'ok') throw new RecipeGuardError(verdict);
}

/**
 * Set or replace the caller's rating (upsert on the primary key, idempotent). The guard is
 * re-checked inside the immediate transaction. Returns false when the recipe is gone. Never
 * touches recipe.updated_at (G5).
 */
export function upsertRating(
  db: Db,
  recipeId: string,
  userId: string,
  stars: number,
  guard?: RecipeGuard,
): boolean {
  return db.transaction(
    (tx) => {
      const row = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!row) return false;
      enforce(guard, row);
      tx.insert(rating)
        .values({ recipeId, userId, stars })
        .onConflictDoUpdate({
          target: [rating.recipeId, rating.userId],
          set: { stars, updatedAt: nowIso() },
        })
        .run();
      return true;
    },
    { behavior: 'immediate' },
  );
}

/** Remove the caller's rating (no-op when none). Returns false when the recipe is gone. */
export function deleteRating(
  db: Db,
  recipeId: string,
  userId: string,
  guard?: RecipeGuard,
): boolean {
  return db.transaction(
    (tx) => {
      const row = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!row) return false;
      enforce(guard, row);
      tx.delete(rating)
        .where(and(eq(rating.recipeId, recipeId), eq(rating.userId, userId)))
        .run();
      return true;
    },
    { behavior: 'immediate' },
  );
}
