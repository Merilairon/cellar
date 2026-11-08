import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  MAIN_EDGE,
  MAX_UPLOAD_PIXELS,
  THUMB_EDGE,
  processImage,
  sniffImage,
  type ImageKind,
} from './process';

const UPLOAD: ImageKind[] = ['jpeg', 'png', 'webp'];
const IMPORT: ImageKind[] = ['jpeg', 'png', 'webp', 'gif'];

const solid = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } });
const jpeg = (w = 40, h = 20) => solid(w, h).jpeg().toBuffer();
const png = (w = 40, h = 20) => solid(w, h).png().toBuffer();
const webp = (w = 40, h = 20) => solid(w, h).webp().toBuffer();
const gif = () => solid(30, 30).gif().toBuffer();
const text = (s: string) => Buffer.from(s);

async function animatedWebp() {
  const w = 20;
  const h = 20;
  const f1 = await solid(w, h).raw().toBuffer();
  const f2 = await sharp({ create: { width: w, height: h, channels: 3, background: '#33c' } })
    .raw()
    .toBuffer();
  return sharp(Buffer.concat([f1, f2]), {
    raw: { width: w, height: h * 2, channels: 3, pageHeight: h },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
}

/** A real 1x1 PNG whose IHDR claims w x h (tiny on disk, huge when decoded). */
async function pngBomb(w: number, h: number) {
  const b = Buffer.from(await png(1, 1));
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b.writeUInt32BE(crc32(b.subarray(12, 29)), 29);
  return b;
}

type Case = {
  name: string;
  make: () => Promise<Uint8Array> | Uint8Array;
  allowed?: ImageKind[];
  fail?: 'unsupported_type' | 'invalid_image' | 'too_many_pixels';
};

const cases: Case[] = [
  { name: 'jpeg accepted', make: () => jpeg() },
  { name: 'png accepted', make: () => png() },
  { name: 'webp accepted', make: () => webp() },
  {
    name: 'png with alpha accepted',
    make: () =>
      sharp({
        create: {
          width: 10,
          height: 10,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer(),
  },
  { name: 'grayscale jpeg accepted', make: () => solid(10, 10).grayscale().jpeg().toBuffer() },
  { name: 'gif refused for upload', make: gif, fail: 'unsupported_type' },
  { name: 'gif accepted for import', make: gif, allowed: IMPORT },
  { name: 'animated webp accepted (first frame)', make: animatedWebp },
  { name: '0-byte file', make: () => new Uint8Array(0), fail: 'unsupported_type' },
  { name: 'single byte', make: () => new Uint8Array([0xff]), fail: 'unsupported_type' },
  {
    name: 'SVG named .jpg',
    make: () => text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    fail: 'unsupported_type',
  },
  {
    name: 'HTML named .png',
    make: () => text('<!doctype html><script>alert(1)</script>'),
    fail: 'unsupported_type',
  },
  { name: 'plain text', make: () => text('hello world'), fail: 'unsupported_type' },
  { name: 'PDF', make: () => text('%PDF-1.7\n'), fail: 'unsupported_type' },
  {
    name: 'truncated jpeg',
    make: async () => (await jpeg(400, 400)).subarray(0, 300),
    fail: 'invalid_image',
  },
  {
    name: 'truncated png',
    make: async () => (await png(200, 200)).subarray(0, 60),
    fail: 'invalid_image',
  },
  {
    name: 'truncated webp',
    make: async () => (await webp(200, 200)).subarray(0, 30),
    fail: 'invalid_image',
  },
  {
    name: 'jpeg header, garbage body',
    make: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 0x41)]),
    fail: 'invalid_image',
  },
  {
    name: 'png signature, garbage body',
    make: () =>
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(200, 0x41),
      ]),
    fail: 'invalid_image',
  },
  {
    name: 'RIFF/WEBP header, garbage body',
    make: () => Buffer.concat([text('RIFF\x10\x00\x00\x00WEBP'), Buffer.alloc(100, 0x41)]),
    fail: 'invalid_image',
  },
  {
    name: 'polyglot: jpeg + trailing html',
    make: async () => Buffer.concat([await jpeg(), text('<script>alert(1)</script>')]),
  },
  {
    name: 'polyglot: png + trailing php',
    make: async () => Buffer.concat([await png(), text('<?php system($_GET[0]); ?>')]),
  },
  {
    name: 'PNG bomb 20000x20000 refused from header',
    make: () => pngBomb(20000, 20000),
    fail: 'too_many_pixels',
  },
  {
    name: 'PNG just over the cap refused',
    make: () => pngBomb(4001, 4000),
    fail: 'too_many_pixels',
  },
  { name: 'PNG 1x1 accepted', make: () => png(1, 1) },
  {
    name: 'EXIF GPS jpeg accepted',
    make: () =>
      solid(40, 20)
        .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
        .jpeg()
        .toBuffer(),
  },
  {
    name: 'EXIF-rotated jpeg accepted',
    make: () => solid(40, 20).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
  },
  { name: 'large jpeg downscaled', make: () => jpeg(3200, 1600) },
];

describe('processImage (table)', () => {
  it.each(cases)('$name', async (c) => {
    const bytes = await c.make();
    const t0 = performance.now();
    const r = await processImage(bytes, { allowed: c.allowed ?? UPLOAD });
    const ms = (performance.now() - t0).toFixed(1);
    console.info(`[timing] ${c.name}: ${ms} ms`);
    if (c.fail) {
      expect(r).toEqual({ ok: false, reason: c.fail });
      return;
    }
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [img, edge] of [
      [r.main, MAIN_EDGE],
      [r.thumb, THUMB_EDGE],
    ] as const) {
      const m = await sharp(img.data).metadata();
      expect(m.format).toBe('webp');
      expect(m.pages ?? 1).toBe(1);
      expect(m.width).toBe(img.width);
      expect(m.height).toBe(img.height);
      expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(edge);
      expect(m.exif).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(m.xmp).toBeUndefined();
    }
    // polyglot trailers are not carried into the output
    expect(r.main.data.includes(Buffer.from('<script>'))).toBe(false);
    expect(r.main.data.includes(Buffer.from('<?php'))).toBe(false);
  });
});

describe('processImage (specifics)', () => {
  it('never upscales small images', async () => {
    const r = await processImage(await png(40, 20), { allowed: UPLOAD });
    expect(r.ok && [r.main.width, r.main.height, r.thumb.width, r.thumb.height]).toEqual([
      40, 20, 40, 20,
    ]);
  });

  it('downscales to 1600 main and 400 thumb, keeping aspect', async () => {
    const r = await processImage(await jpeg(3200, 1600), { allowed: UPLOAD });
    expect(r.ok && [r.main.width, r.main.height, r.thumb.width, r.thumb.height]).toEqual([
      1600, 800, 400, 200,
    ]);
  });

  it('thumb is smaller than main only when main exceeds 400', async () => {
    const r = await processImage(await jpeg(1000, 500), { allowed: UPLOAD });
    expect(r.ok && [r.main.width, r.thumb.width]).toEqual([1000, 400]);
  });

  it('applies EXIF orientation and drops the tag', async () => {
    const bytes = await solid(40, 20).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await processImage(bytes, { allowed: UPLOAD });
    expect(r.ok && [r.main.width, r.main.height]).toEqual([20, 40]);
    if (r.ok) expect((await sharp(r.main.data).metadata()).orientation).toBeUndefined();
  });

  it('input really carries GPS EXIF, output does not', async () => {
    const bytes = await solid(40, 20)
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const r = await processImage(bytes, { allowed: UPLOAD });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((await sharp(r.main.data).metadata()).exif).toBeUndefined();
      expect((await sharp(r.thumb.data).metadata()).exif).toBeUndefined();
    }
  });

  it('animated webp: first frame only', async () => {
    const bytes = await animatedWebp();
    expect((await sharp(bytes, { pages: -1 }).metadata()).pages).toBe(2);
    const r = await processImage(bytes, { allowed: UPLOAD });
    expect(r.ok && [r.main.width, r.main.height]).toEqual([20, 20]);
    if (r.ok) expect((await sharp(r.main.data, { pages: -1 }).metadata()).pages ?? 1).toBe(1);
  });

  it('bomb header is refused quickly without decode', async () => {
    const bytes = await pngBomb(20000, 20000);
    expect(bytes.length).toBeLessThan(200);
    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    const r = await processImage(bytes, { allowed: UPLOAD });
    const ms = performance.now() - t0;
    console.info(
      `[timing] bomb: ${ms.toFixed(1)} ms, rss delta ${((process.memoryUsage().rss - rss0) / 1e6).toFixed(1)} MB`,
    );
    expect(r).toEqual({ ok: false, reason: 'too_many_pixels' });
    expect(ms).toBeLessThan(2000);
  });

  it('pixel cap constant is exported as 16M', () => {
    expect(MAX_UPLOAD_PIXELS).toBe(16_000_000);
  });

  it('a kind that does not match its content is invalid, not trusted', async () => {
    // png bytes under a jpeg-only allowlist
    expect(await processImage(await png(), { allowed: ['jpeg'] })).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
  });

  it('sniffImage recognises the four kinds only', async () => {
    expect([
      sniffImage(await jpeg()),
      sniffImage(await png()),
      sniffImage(await webp()),
      sniffImage(await gif()),
    ]).toEqual(['jpeg', 'png', 'webp', 'gif']);
    expect(sniffImage(text('<svg/>'))).toBeNull();
  });
});
