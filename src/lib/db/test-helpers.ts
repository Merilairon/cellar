import { eq } from 'drizzle-orm';
import type { Db } from './connection';
import { recipe } from './schema';

/** Test-only: ids of the recipes owned by a user. */
export function listRecipeIdsByOwner(db: Db, ownerId: string): string[] {
  return db
    .select({ id: recipe.id })
    .from(recipe)
    .where(eq(recipe.ownerId, ownerId))
    .all()
    .map((r) => r.id);
}
