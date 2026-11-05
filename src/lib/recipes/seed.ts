import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/lib/db/connection';
import { createRecipe } from '@/lib/db/recipes';
import { recipe, user } from '@/lib/db/schema';
import { getUserByEmail, type User } from '@/lib/db/users';
import { SAMPLE_RECIPES } from './samples';
import { recipeInputSchema } from './schemas';
import { prepareRecipe } from './service';

export type SeedResult =
  { ok: true; owner: User; created: string[]; skipped: string[] } | { ok: false; error: string };

/** Pick the target owner: `--user <email>` or the oldest active admin. */
export function resolveSeedOwner(db: Db, email?: string): User | undefined {
  if (email) {
    const u = getUserByEmail(db, email);
    return u && !u.deactivatedAt ? u : undefined;
  }
  return db
    .select()
    .from(user)
    .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)))
    .orderBy(asc(user.createdAt), asc(user.id))
    .get();
}

/** Idempotent: a sample is skipped when the owner already has a recipe with that title. */
export function seedSamples(db: Db, email?: string): SeedResult {
  const owner = resolveSeedOwner(db, email);
  if (!owner) {
    return {
      ok: false,
      error: email
        ? `No active user with email ${email}.`
        : 'No active admin found. Complete /setup first (or pass --user <email>).',
    };
  }
  const created: string[] = [];
  const skipped: string[] = [];
  for (const sample of SAMPLE_RECIPES) {
    const exists = db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(eq(recipe.ownerId, owner.id), eq(recipe.title, sample.title)))
      .get();
    if (exists) {
      skipped.push(sample.title);
      continue;
    }
    const prepared = prepareRecipe(recipeInputSchema.parse(sample));
    if (!prepared.ok) {
      return {
        ok: false,
        error: `Sample "${sample.title}" is invalid: ${JSON.stringify(prepared)}`,
      };
    }
    createRecipe(db, owner.id, prepared.tree);
    created.push(sample.title);
  }
  return { ok: true, owner, created, skipped };
}
