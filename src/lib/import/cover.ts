import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ulid } from 'ulid';
import type { Db } from '@/lib/db/connection';
import { insertCoverPhoto } from '@/lib/db/photos';
import { ImportError } from './errors';
import { limitFetch } from './limiter';
import {
  safeFetch as defaultSafeFetch,
  type SafeFetchOptions,
  type SafeFetchResult,
} from './safe-fetch';

// Cover download (spec req 9). The remote URL is only ever touched by safeFetch (same SSRF
// rules, image accept types, 5 MB cap, 10 s). Bytes are then verified by magic number,
// size-checked before decode, decoded by sharp, resized, stripped of metadata (EXIF/GPS)
// and re-encoded as WebP. The file name is a fresh ULID, never derived from remote input.
// Open item (04c): `POST /api/recipes/:id/copy` does not copy the cover file.

export const MAX_COVER_EDGE = 1600;
/** Pixel cap checked from the header, before any decode (decompression-bomb guard). */
export const MAX_COVER_PIXELS = 40_000_000;

export type CoverDeps = {
  safeFetch?: (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>;
  /** From getEnv() only (allowLocal, userAgent); `accept` is forced to 'image'. */
  fetchOptions?: SafeFetchOptions;
  uploadsDir: string;
};

export type CoverFailure = 'fetch_failed' | 'invalid_image' | 'too_large' | 'blocked';

/** Image kind from magic bytes; SVG and everything else is refused. */
export function sniffImage(b: Uint8Array): 'jpeg' | 'png' | 'webp' | 'gif' | null {
  const at = (i: number) => b[i];
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';
  if (
    b.length >= 8 &&
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  )
    return 'png';
  const ascii = (from: number, s: string) =>
    b.length >= from + s.length && [...s].every((c, i) => at(from + i) === c.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'gif';
  return null;
}

/** Re-encode untrusted image bytes. Throws ImportError('fetch_failed') for anything invalid. */
export async function reencodeCover(
  bytes: Uint8Array,
): Promise<{ data: Buffer; width: number; height: number }> {
  const kind = sniffImage(bytes);
  if (!kind) throw new ImportError('fetch_failed');
  try {
    const input = sharp(bytes, { limitInputPixels: MAX_COVER_PIXELS, failOn: 'error' });
    const meta = await input.metadata();
    if (
      !meta.format ||
      !['jpeg', 'png', 'webp', 'gif'].includes(meta.format) ||
      !meta.width ||
      !meta.height ||
      meta.width * meta.height > MAX_COVER_PIXELS
    ) {
      throw new ImportError('fetch_failed');
    }
    const { data, info } = await input
      .rotate() // apply EXIF orientation, then metadata is dropped (sharp default)
      .resize({
        width: MAX_COVER_EDGE,
        height: MAX_COVER_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('fetch_failed', e);
  }
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
  const { data, width, height } = await reencodeCover(res.body);

  const fileName = `${ulid()}.webp`;
  await mkdir(deps.uploadsDir, { recursive: true, mode: 0o700 });
  const abs = join(deps.uploadsDir, fileName);
  await writeFile(abs, data, { mode: 0o600, flag: 'wx' });
  try {
    return insertCoverPhoto(db, recipeId, { filePath: fileName, width, height }).id;
  } catch (e) {
    await rm(abs, { force: true });
    throw new ImportError('fetch_failed', e);
  }
}
