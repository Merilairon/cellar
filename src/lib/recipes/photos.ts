import { copyFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { Db } from '@/lib/db/connection';
import {
  PhotoLimitError,
  countPhotos,
  deletePhoto,
  insertPhoto,
  insertPhotoRows,
  listPhotos,
  setCover,
  MAX_PHOTOS_PER_RECIPE,
  type PhotoRow,
} from '@/lib/db/photos';
import { getRecipeRow, RecipeGuardError, type RecipeGuard } from '@/lib/db/recipes';
import { processImage } from '@/lib/images/process';
import { LimiterBusyError, busyResponse, limitDecode } from '@/lib/import/limiter';
import { removeUploadFiles, resolveUploadPath } from '@/lib/import/uploads';
import { canRead, canWrite } from './access';
import { failure } from './http';
import type { FieldError } from './schemas';
import type { Actor, Failure } from './service';

// Photo write rules. Reads: canRead (else 404). Writes (upload, delete, cover): canWrite, so a
// reader of a `users` recipe gets 403 and a recipe the actor cannot read is a plain 404. Every
// write re-checks the guard inside its transaction. None of this touches the recipe updated_at stamp
// (G5), so a grid editor open on a stale base still saves without a 409.

export type ApiPhoto = { id: string; width: number; height: number; is_cover: boolean };

export const toApiPhoto = (p: PhotoRow): ApiPhoto => ({
  id: p.id,
  width: p.width,
  height: p.height,
  is_cover: p.isCover,
});

export type PhotoFailure = Failure | { ok: false; status: 503; retryAfterSec: number };

/** Map a photo failure to its response (503 carries Retry-After; 422 field errors). */
export function photoFailure(f: PhotoFailure): Response {
  if (f.status === 503) return busyResponse(new LimiterBusyError(f.retryAfterSec));
  return failure(f);
}

const writeGuard =
  (actor: Actor): RecipeGuard =>
  (row) =>
    !canRead(actor, row) ? 'not_found' : canWrite(actor, row) ? 'ok' : 'forbidden';

const code = (c: string): PhotoFailure => ({
  ok: false,
  status: 422,
  errors: [{ path: 'file', code: c } satisfies FieldError],
});

function guarded<T>(fn: () => T): { ok: true; value: T } | PhotoFailure {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof RecipeGuardError) {
      return { ok: false, status: e.status === 'forbidden' ? 403 : 404 };
    }
    if (e instanceof PhotoLimitError) return code('photo_limit');
    throw e;
  }
}

/** Cheap pre-check shared by the routes (before the body is read); the real check is in the tx. */
export function checkPhotoWrite(db: Db, actor: Actor, recipeId: string): { ok: true } | Failure {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  if (!canWrite(actor, row)) return { ok: false, status: 403 };
  return { ok: true };
}

export function listPhotosFor(
  db: Db,
  actor: Actor,
  recipeId: string,
): { ok: true; photos: ApiPhoto[] } | Failure {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  return { ok: true, photos: listPhotos(db, recipeId).map(toApiPhoto) };
}

export type DecodeLimiter = <T>(fn: () => Promise<T>) => Promise<T>;
export type UploadDeps = {
  uploadsDir: string;
  /** Seam for tests; defaults to the process-wide bounded decode limiter. */
  decode?: DecodeLimiter;
};

/**
 * Validate, re-encode and store one uploaded photo. Order: authorization, cheap limit check,
 * decode (one at a time, bounded queue -> 503), write both files, insert the row; on any
 * failure after the files were written they are unlinked again. Nothing is written for a
 * rejected upload.
 */
export async function uploadPhotoFor(
  db: Db,
  actor: Actor,
  recipeId: string,
  bytes: Uint8Array,
  deps: UploadDeps,
): Promise<{ ok: true; photo: ApiPhoto } | PhotoFailure> {
  const pre = checkPhotoWrite(db, actor, recipeId);
  if (!pre.ok) return pre;
  if (bytes.byteLength === 0) return code('empty_file');
  if (countPhotos(db, recipeId) >= MAX_PHOTOS_PER_RECIPE) return code('photo_limit');

  let processed;
  try {
    processed = await (deps.decode ?? limitDecode)(() =>
      processImage(bytes, { allowed: ['jpeg', 'png', 'webp'] }),
    );
  } catch (e) {
    if (e instanceof LimiterBusyError) {
      return { ok: false, status: 503, retryAfterSec: e.retryAfterSec };
    }
    throw e;
  }
  if (!processed.ok) return code(processed.reason);
  const { main, thumb } = processed;

  const mainName = `${ulid()}.webp`;
  const thumbName = `${ulid()}.webp`;
  const mainAbs = join(deps.uploadsDir, mainName);
  const thumbAbs = join(deps.uploadsDir, thumbName);
  const cleanup = () => Promise.all([rm(mainAbs, { force: true }), rm(thumbAbs, { force: true })]);
  try {
    await mkdir(deps.uploadsDir, { recursive: true, mode: 0o700 });
    await writeFile(mainAbs, main.data, { mode: 0o600, flag: 'wx' });
    await writeFile(thumbAbs, thumb.data, { mode: 0o600, flag: 'wx' });
    const res = guarded(() =>
      insertPhoto(
        db,
        recipeId,
        { filePath: mainName, thumbPath: thumbName, width: main.width, height: main.height },
        writeGuard(actor),
      ),
    );
    if (!res.ok) {
      await cleanup();
      return res;
    }
    if (!res.value) {
      await cleanup();
      return { ok: false, status: 404 };
    }
    return { ok: true, photo: toApiPhoto(res.value) };
  } catch (e) {
    await cleanup().catch(() => undefined);
    throw e;
  }
}

/** Delete one photo: row first (transaction), files after commit, best effort. */
export function deletePhotoFor(
  db: Db,
  actor: Actor,
  recipeId: string,
  photoId: string,
  uploadsDir: string,
): { ok: true } | Failure {
  const pre = checkPhotoWrite(db, actor, recipeId);
  if (!pre.ok) return pre;
  const res = guarded(() => deletePhoto(db, recipeId, photoId, writeGuard(actor)));
  if (!res.ok) return res as Failure;
  if (!res.value) return { ok: false, status: 404 };
  removeUploadFiles(
    uploadsDir,
    res.value.thumbPath ? [res.value.filePath, res.value.thumbPath] : [res.value.filePath],
  );
  return { ok: true };
}

export function setCoverFor(
  db: Db,
  actor: Actor,
  recipeId: string,
  photoId: string,
): { ok: true; photos: ApiPhoto[] } | Failure {
  const pre = checkPhotoWrite(db, actor, recipeId);
  if (!pre.ok) return pre;
  const res = guarded(() => setCover(db, recipeId, photoId, writeGuard(actor)));
  if (!res.ok) return res as Failure;
  if (!res.value) return { ok: false, status: 404 };
  return { ok: true, photos: listPhotos(db, recipeId).map(toApiPhoto) };
}

/**
 * "Save a copy": give the copy its own files (fresh ULID names) and rows, cover flag kept.
 * Best effort and synchronous: a file that cannot be copied is skipped and logged; the recipe
 * copy itself never fails because of photos. Notes and ratings are not copied (G10, Q7).
 */
export function copyPhotosTo(db: Db, uploadsDir: string, fromId: string, toId: string): void {
  const copied: Array<{
    filePath: string;
    thumbPath: string | null;
    width: number;
    height: number;
  }> = [];
  let coverIndex = -1;
  const made: string[] = [];
  const cp = (rel: string): string | null => {
    const src = resolveUploadPath(uploadsDir, rel);
    const name = `${ulid()}.webp`;
    const dst = resolveUploadPath(uploadsDir, name);
    if (!src || !dst) return null;
    try {
      copyFileSync(src, dst, 1 /* COPYFILE_EXCL */);
    } catch (e) {
      console.warn('[photos] could not copy file for recipe copy', (e as Error).message);
      return null;
    }
    made.push(name);
    return name;
  };
  try {
    for (const p of listPhotos(db, fromId)) {
      const filePath = cp(p.filePath);
      if (!filePath) continue;
      // A legacy row has no thumbnail; a failed thumb copy degrades to "serve the main file".
      const thumbPath = p.thumbPath ? cp(p.thumbPath) : null;
      if (p.isCover) coverIndex = copied.length;
      copied.push({ filePath, thumbPath, width: p.width, height: p.height });
    }
    if (copied.length === 0) return;
    insertPhotoRows(db, toId, copied, coverIndex >= 0 ? coverIndex : 0);
  } catch (e) {
    console.warn('[photos] could not copy photos for recipe copy', (e as Error).message);
    removeUploadFiles(uploadsDir, made);
  }
}
