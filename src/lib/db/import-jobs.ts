import { and, eq, ne } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Db } from './connection';
import { importJob, nowIso } from './schema';

// Data access for import jobs. Pipeline logic lives in src/lib/import/.

export type ImportJobRow = typeof importJob.$inferSelect;
export type ImportJobPatch = Partial<
  Pick<
    typeof importJob.$inferInsert,
    'status' | 'method' | 'errorCode' | 'rawHtmlPath' | 'draftJson' | 'url'
  >
>;

export function createImportJob(
  db: Db,
  userId: string,
  fields: { url?: string | null; method?: ImportJobRow['method'] } = {},
): ImportJobRow {
  return db
    .insert(importJob)
    .values({ id: ulid(), userId, url: fields.url ?? null, method: fields.method ?? null })
    .returning()
    .get();
}

/** Owner-scoped read: a job of another user is indistinguishable from a missing one. */
export function getImportJobForUser(db: Db, id: string, userId: string): ImportJobRow | undefined {
  return db
    .select()
    .from(importJob)
    .where(and(eq(importJob.id, id), eq(importJob.userId, userId)))
    .get();
}

export function updateImportJob(db: Db, id: string, patch: ImportJobPatch): void {
  db.update(importJob)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(importJob.id, id))
    .run();
}

/**
 * Atomically move a job to `saved` and link the recipe. Returns false when the job is not
 * the caller's, does not exist, or is already saved (compare-and-set, so a double submit
 * cannot create two recipes when this runs in the same transaction as the insert).
 */
export function markImportJobSaved(db: Db, id: string, userId: string, recipeId: string): boolean {
  const res = db
    .update(importJob)
    .set({ status: 'saved', recipeId, updatedAt: nowIso() })
    .where(and(eq(importJob.id, id), eq(importJob.userId, userId), ne(importJob.status, 'saved')))
    .run();
  return res.changes === 1;
}
