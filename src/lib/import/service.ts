import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@/lib/db/connection';
import { findRecipeBySourceUrl } from '@/lib/db/recipes';
import {
  createImportJob,
  failStaleFetchingJobs,
  pruneImportJobs,
  getImportJobForUser,
  updateImportJob,
  type ImportJobRow,
} from '@/lib/db/import-jobs';
import { limitFetch } from './limiter';
import { readMapping } from './mapping';
import { runImport, type ImportDeps, type ImportInput } from './pipeline';
import { normalizeSourceUrl } from './source-url';
import type { Draft } from './normalize';
import type { ImportJobResponse } from './schemas';

// Job persistence around the pure pipeline. Handlers stay free of SQL; the SSRF seam
// (`deps.fetchOptions`) is supplied by the route from getEnv(), never from the request.

export type ImportServiceDeps = ImportDeps & {
  keepRawHtml?: boolean;
  /** Where raw HTML goes when keepRawHtml (env RAW_HTML_DIR). */
  rawHtmlDir?: string;
  /** Older raw HTML locations pruning may still clean (a moved RAW_HTML_DIR must not orphan files). */
  legacyRawHtmlDirs?: string[];
  /** Retention in days for old import jobs (env IMPORT_JOB_TTL_DAYS); 0/unset disables pruning. */
  jobTtlDays?: number;
};

type Actor = { id: string };

/** A job still `fetching` after this long is dead (static fetch ~10 s plus headless <= 35 s). */
export const STALE_FETCHING_MS = 5 * 60 * 1000;
const failStale = (db: Db, actor: Actor) =>
  failStaleFetchingJobs(db, actor.id, new Date(Date.now() - STALE_FETCHING_MS).toISOString());

const PRUNE_EVERY_MS = 60 * 60 * 1000;
let lastPruneAt = 0;
/** Lazy retention sweep: at most once an hour per process, bounded, never fails the import. */
export function maybePrune(db: Db, deps: ImportServiceDeps, now = Date.now()): void {
  if (!deps.jobTtlDays || !deps.rawHtmlDir || now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  try {
    pruneImportJobs(db, {
      olderThanDays: deps.jobTtlDays,
      now: new Date(now),
      rawHtmlDir: deps.rawHtmlDir,
      extraRawHtmlDirs: deps.legacyRawHtmlDirs,
    });
  } catch (e) {
    deps.log?.('import job prune failed', e);
  }
}

/** Test seam: forget the throttle. */
export function resetPruneThrottle(): void {
  lastPruneAt = 0;
}

/** What is stored in `import_job.draft_json`. */
export type StoredDraft = { v: 1; draft: Draft; warnings: string[] };

export function parseStoredDraft(json: string | null): StoredDraft | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as StoredDraft;
    if (!v || v.v !== 1 || !v.draft) return null;
    // Drafts stored before 3b have no `mapping`: they behave as v0.3.0 (G21). No backfill.
    v.draft.mapping = readMapping(v.draft.mapping);
    return v;
  } catch {
    return null;
  }
}

/**
 * Writes the fetched/pasted HTML (mode 0600, outside uploads, named from the job id).
 * Only reached when KEEP_RAW_HTML is on. Failure is logged and never fails the import.
 */
function writeRawHtml(
  dir: string,
  jobId: string,
  html: string,
  log?: ImportDeps['log'],
): string | null {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${jobId}.html`);
    writeFileSync(path, html, { mode: 0o600 });
    return path;
  } catch (e) {
    log?.('raw html write failed', e);
    return null;
  }
}

/** Serialized view of a job. Deliberately has no raw_html, and no internal error text. */
export function toJobResponse(db: Db, job: ImportJobRow, actor: Actor): ImportJobResponse {
  const stored = parseStoredDraft(job.draftJson);
  const normalized = job.url ? normalizeSourceUrl(job.url) : null;
  const dup =
    normalized && job.status !== 'saved'
      ? findRecipeBySourceUrl(db, normalized, actor.id)
      : undefined;
  return {
    id: job.id,
    status: job.status,
    method: job.method,
    draft: stored?.draft ?? null,
    warnings: stored?.warnings ?? [],
    error_code: job.errorCode,
    confidence: stored?.draft.mapping
      ? Math.round(stored.draft.mapping.confidence * 100) / 100
      : null,
    mapping_level: stored?.draft.mapping?.level ?? null,
    headless:
      job.errorCode === 'headless_unavailable'
        ? 'unavailable'
        : job.method === 'headless'
          ? 'used'
          : null,
    duplicate: dup ? { recipe_id: dup.id, title: dup.title } : null,
  };
}

export async function createImport(
  db: Db,
  actor: Actor,
  input: ImportInput,
  deps: ImportServiceDeps = {},
): Promise<ImportJobResponse> {
  failStale(db, actor);
  maybePrune(db, deps);
  const job = createImportJob(db, actor.id, { method: 'text' in input ? 'paste' : 'static' });
  updateImportJob(db, job.id, { status: 'fetching' });

  const log = deps.log;
  let result;
  try {
    result = await ('text' in input
      ? runImport(input, { ...deps, log })
      : limitFetch(() => runImport(input, { ...deps, log })));
  } catch (e) {
    // Busy limiter (or any escape): never leave the row `fetching`.
    updateImportJob(db, job.id, { status: 'failed', errorCode: 'fetch_failed' });
    throw e;
  }

  const rawHtmlPath =
    deps.keepRawHtml && deps.rawHtmlDir && result.raw_html
      ? writeRawHtml(deps.rawHtmlDir, job.id, result.raw_html, log)
      : null;

  const stored: StoredDraft | null =
    result.status === 'needs_review' && result.draft
      ? { v: 1, draft: result.draft, warnings: result.warnings }
      : null;
  updateImportJob(db, job.id, {
    status: result.status,
    method: result.method,
    errorCode: result.error_code,
    url: result.source_url,
    rawHtmlPath,
    draftJson: stored ? JSON.stringify(stored) : null,
  });

  const fresh = getImportJobForUser(db, job.id, actor.id)!;
  const response = toJobResponse(db, fresh, actor);
  // A failed job carries the parser warnings (useful for the paste hint) but no draft.
  if (result.status === 'failed') response.warnings = result.warnings;
  if (result.headless) response.headless = result.headless;
  return response;
}

export function getImportFor(db: Db, actor: Actor, id: string): ImportJobResponse | null {
  failStale(db, actor);
  const job = getImportJobForUser(db, id, actor.id);
  return job ? toJobResponse(db, job, actor) : null;
}
