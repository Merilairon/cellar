import sharp from 'sharp';
import { expect, type BrowserContext, type Locator } from '@playwright/test';
import { ORIGIN } from './helpers';

/** Small real images, generated at load so no binary fixtures live in the repo. */
export async function makeImage(
  format: 'jpeg' | 'png',
  color: { r: number; g: number; b: number },
  width = 640,
  height = 480,
): Promise<Buffer> {
  const img = sharp({ create: { width, height, channels: 3, background: color } });
  return format === 'jpeg' ? img.jpeg().toBuffer() : img.png().toBuffer();
}

export const SVG_AS_JPG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
);

/** POST raw image bytes the way the UI does; returns the response. */
export async function apiUpload(
  ctx: BrowserContext,
  recipeId: string,
  bytes: Buffer,
  type: string,
) {
  return ctx.request.post(`/api/recipes/${recipeId}/photos`, {
    headers: { ...ORIGIN, 'content-type': type },
    data: bytes,
  });
}

export type PhotoRow = { id: string; width: number; height: number; is_cover: boolean };
export async function apiPhotos(ctx: BrowserContext, recipeId: string): Promise<PhotoRow[]> {
  const res = await ctx.request.get(`/api/recipes/${recipeId}/photos`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { photos: PhotoRow[] }).photos;
}

/** The image really decoded in the browser (not a broken-image icon). */
export async function expectLoaded(img: Locator) {
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}
