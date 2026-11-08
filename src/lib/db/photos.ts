import { and, asc, eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Db } from './connection';
import { readableBy } from './readable';
import { RecipeGuardError, type RecipeGuard } from './recipes';
import { photo, recipe } from './schema';

/** At most this many photos per recipe (G12, Q11). */
export const MAX_PHOTOS_PER_RECIPE = 10;

export class PhotoLimitError extends Error {
  constructor() {
    super('photo limit reached');
  }
}

export type PhotoRow = typeof photo.$inferSelect;

/** Insert the cover photo of a recipe, replacing any previous cover. Returns the row. */
export function insertCoverPhoto(
  db: Db,
  recipeId: string,
  file: { filePath: string; thumbPath?: string | null; width: number; height: number },
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

const ORDER = [asc(photo.position), asc(photo.createdAt), asc(photo.id)] as const;

/** Photos of a recipe in display order (position, created_at, id). */
export function listPhotos(db: Db, recipeId: string): PhotoRow[] {
  return db
    .select()
    .from(photo)
    .where(eq(photo.recipeId, recipeId))
    .orderBy(...ORDER)
    .all();
}

export function countPhotos(db: Db, recipeId: string): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(photo)
    .where(eq(photo.recipeId, recipeId))
    .get()!.n;
}

/**
 * Cover photo id of every recipe the user may read, from one query (list cards, G13).
 * Never touches the recipe updated_at stamp.
 */
export function coverPhotoIdsFor(db: Db, userId: string): Map<string, string> {
  const rows = db
    .select({ recipeId: photo.recipeId, id: photo.id })
    .from(photo)
    .where(
      and(
        eq(photo.isCover, true),
        sql`${photo.recipeId} in (select ${recipe.id} from ${recipe} where ${readableBy(userId)})`,
      ),
    )
    .all();
  return new Map(rows.map((r) => [r.recipeId, r.id]));
}

function enforce(guard: RecipeGuard | undefined, row: typeof recipe.$inferSelect): void {
  const verdict = guard ? guard(row) : 'ok';
  if (verdict !== 'ok') throw new RecipeGuardError(verdict);
}

/**
 * Insert a photo at the end of the recipe's order. The first photo (no cover yet) becomes the
 * cover. The recipe guard and the 10 photo cap are re-checked inside the immediate
 * transaction (two concurrent uploads cannot both pass). Returns undefined when the recipe is
 * gone. Does not touch the recipe updated_at stamp (G5).
 */
export function insertPhoto(
  db: Db,
  recipeId: string,
  file: { filePath: string; thumbPath: string | null; width: number; height: number },
  guard?: RecipeGuard,
): PhotoRow | undefined {
  return db.transaction(
    (tx) => {
      const row = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!row) return undefined;
      enforce(guard, row);
      const existing = tx
        .select({ n: sql<number>`count(*)`, last: sql<number>`coalesce(max(position), -1)` })
        .from(photo)
        .where(eq(photo.recipeId, recipeId))
        .get()!;
      if (existing.n >= MAX_PHOTOS_PER_RECIPE) throw new PhotoLimitError();
      const hasCover = tx
        .select({ id: photo.id })
        .from(photo)
        .where(and(eq(photo.recipeId, recipeId), eq(photo.isCover, true)))
        .get();
      return tx
        .insert(photo)
        .values({ id: ulid(), recipeId, ...file, position: existing.last + 1, isCover: !hasCover })
        .returning()
        .get();
    },
    { behavior: 'immediate' },
  );
}

/**
 * Insert already-copied photo rows (Save a copy). `coverIndex` picks the cover; the rest keep
 * the given order. No limit check: the source already respected it.
 */
export function insertPhotoRows(
  db: Db,
  recipeId: string,
  files: Array<{ filePath: string; thumbPath: string | null; width: number; height: number }>,
  coverIndex: number,
): void {
  db.transaction(
    (tx) => {
      files.forEach((f, i) =>
        tx
          .insert(photo)
          .values({ id: ulid(), recipeId, ...f, position: i, isCover: i === coverIndex })
          .run(),
      );
    },
    { behavior: 'immediate' },
  );
}

/**
 * Make `photoId` the cover of `recipeId` in one immediate transaction (never zero or two
 * covers; `photo_one_cover_uq` is the backstop). Returns false when the photo is not on this
 * recipe or the recipe is gone.
 */
export function setCover(db: Db, recipeId: string, photoId: string, guard?: RecipeGuard): boolean {
  return db.transaction(
    (tx) => {
      const row = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!row) return false;
      enforce(guard, row);
      const target = tx
        .select({ id: photo.id })
        .from(photo)
        .where(and(eq(photo.id, photoId), eq(photo.recipeId, recipeId)))
        .get();
      if (!target) return false;
      tx.update(photo).set({ isCover: false }).where(eq(photo.recipeId, recipeId)).run();
      tx.update(photo).set({ isCover: true }).where(eq(photo.id, photoId)).run();
      return true;
    },
    { behavior: 'immediate' },
  );
}

/**
 * Delete a photo row (the caller unlinks the files after commit). Deleting the cover promotes
 * the next photo by position, created_at, id. Returns the removed paths, or undefined when
 * the photo is not on this recipe.
 */
export function deletePhoto(
  db: Db,
  recipeId: string,
  photoId: string,
  guard?: RecipeGuard,
): { filePath: string; thumbPath: string | null } | undefined {
  return db.transaction(
    (tx) => {
      const row = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!row) return undefined;
      enforce(guard, row);
      const p = tx
        .select()
        .from(photo)
        .where(and(eq(photo.id, photoId), eq(photo.recipeId, recipeId)))
        .get();
      if (!p) return undefined;
      tx.delete(photo).where(eq(photo.id, photoId)).run();
      if (p.isCover) {
        const next = tx
          .select({ id: photo.id })
          .from(photo)
          .where(eq(photo.recipeId, recipeId))
          .orderBy(...ORDER)
          .get();
        if (next) tx.update(photo).set({ isCover: true }).where(eq(photo.id, next.id)).run();
      }
      return { filePath: p.filePath, thumbPath: p.thumbPath };
    },
    { behavior: 'immediate' },
  );
}

/** Relative paths (main and thumb) of all photos of a recipe, for file cleanup. */
export function listPhotoPathsByRecipe(db: Db, recipeId: string): string[] {
  return db
    .select({ filePath: photo.filePath, thumbPath: photo.thumbPath })
    .from(photo)
    .where(eq(photo.recipeId, recipeId))
    .all()
    .flatMap((r) => (r.thumbPath ? [r.filePath, r.thumbPath] : [r.filePath]));
}
