import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Db } from './connection';
import { photo } from './schema';

export type PhotoRow = typeof photo.$inferSelect;

/** Insert the cover photo of a recipe, replacing any previous cover. Returns the row. */
export function insertCoverPhoto(
  db: Db,
  recipeId: string,
  file: { filePath: string; width: number; height: number },
): PhotoRow {
  return db.transaction(
    (tx) => {
      tx.update(photo).set({ isCover: false }).where(eq(photo.recipeId, recipeId)).run();
      return tx
        .insert(photo)
        .values({ id: ulid(), recipeId, ...file, position: 0, isCover: true })
        .returning()
        .get();
    },
    { behavior: 'immediate' },
  );
}

export function getPhoto(db: Db, id: string): PhotoRow | undefined {
  return db.select().from(photo).where(eq(photo.id, id)).get();
}

export function getCoverPhoto(db: Db, recipeId: string): PhotoRow | undefined {
  return db
    .select()
    .from(photo)
    .where(eq(photo.recipeId, recipeId))
    .orderBy(asc(photo.position))
    .all()
    .find((p) => p.isCover);
}

/** Relative file paths of all photos of a recipe (read before deleting the recipe). */
export function listPhotoPathsByRecipe(db: Db, recipeId: string): string[] {
  return db
    .select({ filePath: photo.filePath })
    .from(photo)
    .where(eq(photo.recipeId, recipeId))
    .all()
    .map((r) => r.filePath);
}
