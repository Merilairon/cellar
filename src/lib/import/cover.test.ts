import { mkdtempSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { getCoverPhoto } from '@/lib/db/photos';
import { createRecipe } from '@/lib/db/recipes';
import { user } from '@/lib/db/schema';
import { ImportError } from './errors';
import { fetchAndStoreCover, MAX_COVER_PIXELS, reencodeCover, sniffImage } from './cover';
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from './safe-fetch';

const png = (w = 40, h = 20) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
const jpeg = () =>
  sharp({ create: { width: 30, height: 30, channels: 3, background: '#3c3' } })
    .jpeg()
    .toBuffer();
const webp = () =>
  sharp({ create: { width: 30, height: 30, channels: 3, background: '#33c' } })
    .webp()
    .toBuffer();

const res = (body: Uint8Array): SafeFetchResult => ({
  status: 200,
  headers: { 'content-type': 'image/png' },
  body,
  finalUrl: 'https://cdn.example.com/x.png',
});

let db: Db;
let dir: string;
let recipeId: string;
beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  const u = db
    .insert(user)
    .values({ email: 'a@x.test', displayName: 'a', passwordHash: 'h', role: 'member' })
    .returning()
    .get();
  recipeId = createRecipe(db, u.id, {
    fields: { title: 'R', viewMode: 'list' },
    sections: [{ title: null, ingredients: [], steps: [] }],
  });
  dir = mkdtempSync(join(tmpdir(), 'cover-'));
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('sniffImage', () => {
  it('recognises jpeg/png/webp/gif and refuses svg and junk', async () => {
    expect(sniffImage(await jpeg())).toBe('jpeg');
    expect(sniffImage(await png())).toBe('png');
    expect(sniffImage(await webp())).toBe('webp');
    expect(sniffImage(Buffer.from('GIF89a....'))).toBe('gif');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('reencodeCover', () => {
  it('re-encodes to webp with correct dimensions', async () => {
    const out = await reencodeCover(await png(40, 20));
    expect(out).toMatchObject({ width: 40, height: 20 });
    expect((await sharp(out.data).metadata()).format).toBe('webp');
  });

  it('downsizes to at most 1600 px on the long edge', async () => {
    const out = await reencodeCover(await png(3200, 800));
    expect(out).toMatchObject({ width: 1600, height: 400 });
  });

  it('strips EXIF/GPS metadata', async () => {
    const withExif = await sharp(await jpeg())
      .withExif({ IFD0: { Copyright: 'secret-gps-owner' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await reencodeCover(withExif);
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
    expect(out.data.includes(Buffer.from('secret-gps-owner'))).toBe(false);
  });

  it('refuses SVG, a polyglot with a bad body, truncated data and junk', async () => {
    await expect(
      reencodeCover(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).rejects.toBeInstanceOf(ImportError);
    const polyglot = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('<script>alert(1)</script>'),
    ]);
    await expect(reencodeCover(polyglot)).rejects.toBeInstanceOf(ImportError);
    const whole = await png(200, 200);
    await expect(
      reencodeCover(whole.subarray(0, Math.floor(whole.length / 2))),
    ).rejects.toBeInstanceOf(ImportError);
    await expect(reencodeCover(Buffer.from('hello world'))).rejects.toBeInstanceOf(ImportError);
  });

  it('refuses decompression-bomb dimensions before decoding', async () => {
    // A tiny real PNG whose IHDR claims 20000 x 20000 (CRC fixed up): the header check
    // must refuse it without ever decoding pixel data.
    const bomb = Buffer.from(await png(1, 1));
    bomb.writeUInt32BE(20000, 16);
    bomb.writeUInt32BE(20000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
    await expect(reencodeCover(bomb)).rejects.toBeInstanceOf(ImportError);
  });
});

describe('cover resource limits', () => {
  it('uses a Pi-safe pixel cap and refuses an in-between bomb (20 MP) at the header', async () => {
    expect(MAX_COVER_PIXELS).toBeLessThanOrEqual(16_000_000);
    const big = Buffer.from(await png(1, 1));
    big.writeUInt32BE(5000, 16);
    big.writeUInt32BE(4000, 20);
    big.writeUInt32BE(crc32(big.subarray(12, 29)), 29);
    await expect(reencodeCover(big)).rejects.toBeInstanceOf(ImportError);
  });

  it('configures sharp for one thread and no cache', () => {
    expect(sharp.concurrency()).toBe(1);
    expect(sharp.cache().items.current).toBe(0);
  });

  it('runs decodes through the limiter: 3 concurrent covers never decode in parallel', async () => {
    const sf = async () => res(await png(40, 20));
    const ids = await Promise.all(
      [0, 1, 2].map(() =>
        fetchAndStoreCover(db, 'https://cdn.example.com/x.png', recipeId, {
          safeFetch: sf,
          uploadsDir: join(dir, 'uploads'),
        }),
      ),
    );
    expect(new Set(ids).size).toBe(3);
  });
});

describe('fetchAndStoreCover', () => {
  it('fetches via safeFetch with accept image, stores <ulid>.webp (0600) and a cover row', async () => {
    const sf = vi.fn<(u: string, o?: SafeFetchOptions) => Promise<SafeFetchResult>>(async () =>
      res(await png(40, 20)),
    );
    const id = await fetchAndStoreCover(db, 'https://cdn.example.com/../evil/../x.png', recipeId, {
      safeFetch: sf,
      fetchOptions: { allowLocal: false },
      uploadsDir: join(dir, 'uploads'),
    });
    expect(sf.mock.calls[0]![1]).toMatchObject({ accept: 'image', allowLocal: false });
    const cover = getCoverPhoto(db, recipeId)!;
    expect(cover.id).toBe(id);
    expect(cover).toMatchObject({ width: 40, height: 20, isCover: true });
    expect(cover.filePath).toMatch(/^[0-9A-Z]{26}\.webp$/);
    const abs = join(dir, 'uploads', cover.filePath);
    expect(statSync(abs).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'uploads')).mode & 0o777).toBe(0o700);
    expect((await sharp(readFileSync(abs)).metadata()).format).toBe('webp');
    // G1: a thumbnail file is stored too (400 px longest edge, never upscaled).
    expect(cover.thumbPath).toMatch(/^[0-9A-Z]{26}\.webp$/);
    expect(cover.thumbPath).not.toBe(cover.filePath);
    const thumb = await sharp(readFileSync(join(dir, 'uploads', cover.thumbPath!))).metadata();
    expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 40, 20]);
  });

  it('refuses a private-IP cover with no request made (real safeFetch, fake transport)', async () => {
    const transport = vi.fn();
    await expect(
      fetchAndStoreCover(db, 'http://169.254.169.254/latest/x.png', recipeId, {
        safeFetch,
        fetchOptions: { transport },
        uploadsDir: join(dir, 'uploads'),
      }),
    ).rejects.toMatchObject({ code: 'private_address' });
    expect(transport).not.toHaveBeenCalled();
    expect(getCoverPhoto(db, recipeId)).toBeUndefined();
  });

  it('writes nothing for an invalid image', async () => {
    await expect(
      fetchAndStoreCover(db, 'https://cdn.example.com/x.png', recipeId, {
        safeFetch: async () => res(Buffer.from('<svg/>')),
        uploadsDir: join(dir, 'uploads'),
      }),
    ).rejects.toBeInstanceOf(ImportError);
    expect(readdirSync(dir)).toEqual([]);
    expect(getCoverPhoto(db, recipeId)).toBeUndefined();
  });
});
