import { unlinkSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { and, asc, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
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
 * the caller's, does not exist, or is not `needs_review` (compare-and-set, so a double submit
 * cannot create two recipes when this runs in the same transaction as the insert).
 */
export function markImportJobSaved(db: Db, id: string, userId: string, recipeId: string): boolean {
  const res = db
    .update(importJob)
    .set({ status: 'saved', recipeId, updatedAt: nowIso() })
    .where(
      and(eq(importJob.id, id), eq(importJob.userId, userId), eq(importJob.status, 'needs_review')),
    )
    .run();
  return res.changes === 1;
}

/**
 * Lazy recovery for jobs stuck in `fetching` (crash or restart mid-fetch): the user's jobs
 * not updated since `cutoffIso` become `failed/fetch_failed`. No background process.
 */
export function failStaleFetchingJobs(db: Db, userId: string, cutoffIso: string): number {
  return db
    .update(importJob)
    .set({ status: 'failed', errorCode: 'fetch_failed', updatedAt: nowIso() })
    .where(
      and(
        eq(importJob.userId, userId),
        eq(importJob.status, 'fetching'),
        lt(importJob.updatedAt, cutoffIso),
      ),
    )
    .run().changes;
}

const PRUNABLE_STATUSES = ['failed', 'needs_review', 'parsed'] as const;
const RAW_FILE_RE = /^[0-9A-Za-z]{26}\.html$/;
export const PRUNE_BATCH = 100;

/**
 * Resolves a stored raw HTML path only when it is `<rawHtmlDir>/<26-char id>.html` exactly.
 * The DB value is never trusted: anything else (traversal, other dir, other name) is ignored.
 */
export function confinedRawHtmlPath(rawHtmlDir: string, stored: string | null): string | null {
  if (!stored) return null;
  const dir = resolve(rawHtmlDir);
  const file = resolve(stored);
  return dirname(file) === dir && RAW_FILE_RE.test(basename(file)) ? file : null;
}

export type PruneResult = { deleted: number; trimmed: number; filesRemoved: number };

/**
 * Retention rule (lazy, bounded, idempotent). Jobs not updated for `olderThanDays` days:
 *  - `failed`, `needs_review`, `parsed`: row deleted, raw HTML file unlinked;
 *  - `saved`: row kept (provenance, duplicate lookup), `draft_json` and `raw_html_path`
 *    cleared, raw HTML file unlinked.
 * `queued`/`fetching` are never touched. Recipes and photos are never touched. Each row is
 * changed with a compare-and-set on its status and `updated_at`, so a job saved or updated
 * concurrently is skipped. Files are removed after the commit, best effort.
 */
export function pruneImportJobs(
  db: Db,
  opts: {
    olderThanDays: number;
    now?: Date;
    rawHtmlDir: string;
    /** Further directories whose raw files may be unlinked (e.g. the v0.3.0 location). */
    extraRawHtmlDirs?: string[];
    limit?: number;
    /** Test seam: runs between the SELECT and the compare-and-set writes. */
    afterSelect?: (rows: { id: string }[]) => void;
  },
): PruneResult {
  const result: PruneResult = { deleted: 0, trimmed: 0, filesRemoved: 0 };
  if (!(opts.olderThanDays > 0)) return result;
  const cutoff = new Date((opts.now ?? new Date()).getTime() - opts.olderThanDays * 86_400_000);
  const cutoffIso = cutoff.toISOString();
  const files: string[] = [];
  const dirs = [opts.rawHtmlDir, ...(opts.extraRawHtmlDirs ?? [])];

  db.transaction(
    (tx) => {
      const rows = tx
        .select({
          id: importJob.id,
          status: importJob.status,
          updatedAt: importJob.updatedAt,
          rawHtmlPath: importJob.rawHtmlPath,
        })
        .from(importJob)
        .where(
          and(
            lt(importJob.updatedAt, cutoffIso),
            or(
              inArray(importJob.status, [...PRUNABLE_STATUSES]),
              and(
                eq(importJob.status, 'saved'),
                or(isNotNull(importJob.draftJson), isNotNull(importJob.rawHtmlPath)),
              ),
            ),
          ),
        )
        .orderBy(asc(importJob.updatedAt))
        .limit(opts.limit ?? PRUNE_BATCH)
        .all();
      opts.afterSelect?.(rows);
      for (const r of rows) {
        const same = and(
          eq(importJob.id, r.id),
          eq(importJob.status, r.status),
          eq(importJob.updatedAt, r.updatedAt),
        );
        const changed =
          r.status === 'saved'
            ? tx.update(importJob).set({ draftJson: null, rawHtmlPath: null }).where(same).run()
                .changes
            : tx.delete(importJob).where(same).run().changes;
        if (changed !== 1) continue;
        if (r.status === 'saved') result.trimmed++;
        else result.deleted++;
        for (const d of dirs) {
          const f = confinedRawHtmlPath(d, r.rawHtmlPath);
          if (f) {
            files.push(f);
            break;
          }
        }
      }
    },
    { behavior: 'immediate' },
  );

  for (const f of files) {
    try {
      unlinkSync(f);
      result.filesRemoved++;
    } catch {
      // Missing or unremovable file is fine; the row no longer references it.
    }
  }
  return result;
}
