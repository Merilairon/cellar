import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { Db } from '@/lib/db/connection';
import { insertCoverPhoto } from '@/lib/db/photos';
import { MAIN_EDGE, MAX_UPLOAD_PIXELS, processImage, sniffImage } from '@/lib/images/process';
import { ImportError } from './errors';
import { limitDecode, limitFetch } from './limiter';
import {
  safeFetch as defaultSafeFetch,
  type SafeFetchOptions,
  type SafeFetchResult,
} from './safe-fetch';

// Cover download (spec req 9). The remote URL is only ever touched by safeFetch (same SSRF
// rules, image accept types, 5 MB cap, 10 s). Bytes are then verified by magic number,
// size-checked before decode, decoded by sharp, resized, stripped of metadata (EXIF/GPS)
// and re-encoded as WebP. The file name is a fresh ULID, never derived from remote input.
// Main and thumbnail files are both stored (G1); "Save a copy" copies them (recipes/photos.ts).

export const MAX_COVER_EDGE = MAIN_EDGE;
export const MAX_COVER_PIXELS = MAX_UPLOAD_PIXELS;
export { sniffImage };

// Imports keep accepting gif (first frame only); uploads do not.
const IMPORT_ALLOWED = ['jpeg', 'png', 'webp', 'gif'] as const;

export type CoverDeps = {
  safeFetch?: (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>;
  /** From getEnv() only (allowLocal, userAgent); `accept` is forced to 'image'. */
  fetchOptions?: SafeFetchOptions;
  uploadsDir: string;
};

export type CoverFailure = 'fetch_failed' | 'invalid_image' | 'too_large' | 'blocked';

/** Re-encode untrusted image bytes. Throws ImportError('fetch_failed') for anything invalid. */
export async function reencodeCover(
  bytes: Uint8Array,
): Promise<{ data: Buffer; width: number; height: number }> {
  const r = await processImage(bytes, { allowed: IMPORT_ALLOWED });
  if (!r.ok) throw new ImportError('fetch_failed');
  return r.main;
}

/**
 * Download, re-encode and store the cover of `recipeId`. Throws ImportError on any failure
 * (the caller treats that as a non-fatal warning). Returns the new photo id.
 */
export async function fetchAndStoreCover(
  db: Db,
  url: string,
  recipeId: string,
  deps: CoverDeps,
): Promise<string> {
  const fetchImage = deps.safeFetch ?? defaultSafeFetch;
  const res = await limitFetch(() => fetchImage(url, { ...deps.fetchOptions, accept: 'image' }));
  const processed = await limitDecode(() => processImage(res.body, { allowed: IMPORT_ALLOWED }));
  if (!processed.ok) throw new ImportError('fetch_failed');
  const { main, thumb } = processed;

  // Both files are written before the row; on any failure nothing stays on disk (G1, G11).
  const mainName = `${ulid()}.webp`;
  const thumbName = `${ulid()}.webp`;
  await mkdir(deps.uploadsDir, { recursive: true, mode: 0o700 });
  const mainAbs = join(deps.uploadsDir, mainName);
  const thumbAbs = join(deps.uploadsDir, thumbName);
  try {
    await writeFile(mainAbs, main.data, { mode: 0o600, flag: 'wx' });
    await writeFile(thumbAbs, thumb.data, { mode: 0o600, flag: 'wx' });
    return insertCoverPhoto(db, recipeId, {
      filePath: mainName,
      thumbPath: thumbName,
      width: main.width,
      height: main.height,
    }).id;
  } catch (e) {
    await rm(mainAbs, { force: true });
    await rm(thumbAbs, { force: true });
    throw new ImportError('fetch_failed', e);
  }
}
