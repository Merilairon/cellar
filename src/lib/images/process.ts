import sharp from 'sharp';

// Shared image pipeline (uploads and import covers use this one decode path). Pure bytes in,
// bytes out: no file system, no DB. Untrusted input: magic bytes, header pixel cap, one decode,
// EXIF rotate, metadata dropped, always re-encoded as WebP, first frame only, never upscaled.

/** Longest edge of the stored main image. */
export const MAIN_EDGE = 1600;
/** Longest edge of the thumbnail. */
export const THUMB_EDGE = 400;
/** WebP quality, tuned in one place (T14). */
export const MAIN_QUALITY = 80;
export const THUMB_QUALITY = 80;
/** Pixel cap checked from the header, before any decode (decompression-bomb guard). */
export const MAX_UPLOAD_PIXELS = 16_000_000;

// Small hosts (Raspberry Pi): one libvips thread, no operation cache.
sharp.concurrency(1);
sharp.cache(false);

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif';
export type ImageFailure = 'unsupported_type' | 'invalid_image' | 'too_many_pixels';
export type EncodedImage = { data: Buffer; width: number; height: number };
export type ProcessResult =
  { ok: true; main: EncodedImage; thumb: EncodedImage } | { ok: false; reason: ImageFailure };

/** Image kind from magic bytes; SVG and everything else is refused. */
export function sniffImage(b: Uint8Array): ImageKind | null {
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

const fail = (reason: ImageFailure): ProcessResult => ({ ok: false, reason });

/** Never throws: every failure is a typed result. */
export async function processImage(
  bytes: Uint8Array,
  opts: { allowed: readonly ImageKind[] },
): Promise<ProcessResult> {
  const kind = sniffImage(bytes);
  if (!kind || !opts.allowed.includes(kind)) return fail('unsupported_type');
  try {
    const input = sharp(bytes, {
      limitInputPixels: MAX_UPLOAD_PIXELS,
      failOn: 'error',
      sequentialRead: true,
    });
    const meta = await input.metadata();
    if (meta.format !== kind) return fail('invalid_image');
    if (!meta.width || !meta.height) return fail('invalid_image');
    if (meta.width * meta.height > MAX_UPLOAD_PIXELS) return fail('too_many_pixels');

    // One decode: rotate (EXIF), downscale, keep raw pixels; both WebP files come from those.
    const { data: raw, info } = await input
      .rotate()
      .resize({ width: MAIN_EDGE, height: MAIN_EDGE, fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rawOpts = { raw: { width: info.width, height: info.height, channels: info.channels } };
    const main = await sharp(raw, rawOpts)
      .webp({ quality: MAIN_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(raw, rawOpts)
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      main: { data: main.data, width: main.info.width, height: main.info.height },
      thumb: { data: thumb.data, width: thumb.info.width, height: thumb.info.height },
    };
  } catch (e) {
    return fail(
      /pixel limit/i.test(String((e as Error)?.message)) ? 'too_many_pixels' : 'invalid_image',
    );
  }
}
