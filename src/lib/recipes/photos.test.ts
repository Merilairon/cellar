import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { photo, recipe, user } from '@/lib/db/schema';
import { listPhotos } from '@/lib/db/photos';
import type { User } from '@/lib/db/users';
import { createConcurrencyLimiter } from '@/lib/import/limiter';
import { SAMPLE_SKILLET_COOKIES } from './samples';
import { PHOTO_BODY_MAX, readCappedBytes } from './http';
import { uploadPhotoFor } from './photos';
import { configureUploads, uploadsInFlight } from './upload-gate';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown, dir: '' }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ BASE_URL: 'http://localhost:3100', UPLOADS_DIR: state.dir }),
}));

import { POST as createRecipePost } from '@/app/api/recipes/route';
import { GET as recipeGet, DELETE as recipeDelete } from '@/app/api/recipes/[id]/route';
import { GET as listGet } from '@/app/api/recipes/route';
import { PUT as gridPut } from '@/app/api/recipes/[id]/grid/route';
import { POST as copyPost } from '@/app/api/recipes/[id]/copy/route';
import { GET as photosGet, POST as photosPost } from '@/app/api/recipes/[id]/photos/route';
import { PUT as coverPut } from '@/app/api/recipes/[id]/photos/[photoId]/cover/route';
import { DELETE as photoDelete, GET as photoGet } from '@/app/api/photos/[id]/route';

type P = { id: string; width: number; height: number; is_cover: boolean };

let db: Db;
let dir: string;
let owner: User;
let alice: User;
let admin: User;
const mk = (name: string, role: 'admin' | 'member' = 'member') =>
  db
    .insert(user)
    .values({ email: `${name}@x.test`, displayName: name, passwordHash: 'h', role })
    .returning()
    .get();
const as = (u: User | null) => {
  state.current = u;
};

const png = (w = 40, h = 20, c = '#c33') =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } })
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

const same = { 'sec-fetch-site': 'same-origin' };
const base = 'http://localhost:3100/api/recipes/x/photos';
const ctx = (id: string, photoId = '') => ({ params: Promise.resolve({ id, photoId }) });
const pctx = (id: string) => ({ params: Promise.resolve({ id }) });
const upload = (
  rid: string,
  body: Uint8Array | string,
  type: string | null = 'image/png',
  headers: Record<string, string> = same,
) =>
  photosPost(
    new Request(base, {
      method: 'POST',
      headers: { ...headers, ...(type ? { 'content-type': type } : {}) },
      body: body as BodyInit,
    }),
    ctx(rid),
  );
const get = (rid: string) => photosGet(new Request(base, { headers: same }), ctx(rid));
const getPhoto = (id: string, query = '', headers: Record<string, string> = same) =>
  photoGet(new Request(`http://localhost:3100/api/photos/${id}${query}`, { headers }), pctx(id));
const delPhoto = (id: string, headers: Record<string, string> = same) =>
  photoDelete(
    new Request(`http://localhost:3100/api/photos/${id}`, { method: 'DELETE', headers }),
    pctx(id),
  );
const putCover = (rid: string, pid: string, headers: Record<string, string> = same) =>
  coverPut(new Request(base, { method: 'PUT', headers }), ctx(rid, pid));
const jsonReq = (method: string, body?: unknown) =>
  new Request('http://localhost:3100/api/recipes', {
    method,
    headers: { ...same, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function makeRecipe(visibility: 'private' | 'users' = 'users', by: User = owner) {
  as(by);
  const res = await createRecipePost(jsonReq('POST', { ...SAMPLE_SKILLET_COOKIES, visibility }));
  return ((await res.json()) as { id: string }).id;
}
async function add(rid: string, by: User = owner, bytes?: Uint8Array): Promise<P> {
  as(by);
  const res = await upload(rid, bytes ?? (await png()));
  expect(res.status).toBe(201);
  return (await res.json()) as P;
}
const files = () => (existsSync(state.dir) ? readdirSync(state.dir).sort() : []);
const rows = () => db.select().from(photo).all().length;

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  dir = mkdtempSync(join(tmpdir(), 'ph4-'));
  state.dir = join(dir, 'uploads');
  owner = mk('owner');
  alice = mk('alice');
  admin = mk('admin', 'admin');
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
  delete (globalThis as { __importDecodeLimiter?: unknown }).__importDecodeLimiter;
});

describe('photo authorization matrix', () => {
  it('owner uploads (201), lists, sets cover and deletes', async () => {
    const rid = await makeRecipe('private');
    const p1 = await add(rid);
    const p2 = await add(rid);
    as(owner);
    const list = (await (await get(rid)).json()) as { photos: P[] };
    expect(list.photos.map((p) => [p.id, p.is_cover])).toEqual([
      [p1.id, true],
      [p2.id, false],
    ]);
    const cov = await putCover(rid, p2.id);
    expect(cov.status).toBe(200);
    expect(((await cov.json()) as { photos: P[] }).photos.map((p) => p.is_cover)).toEqual([
      false,
      true,
    ]);
    expect((await delPhoto(p2.id)).status).toBe(204);
  });

  it('admin may write on another member recipe (canWrite parity)', async () => {
    const rid = await makeRecipe('private');
    const p = await add(rid, admin);
    as(admin);
    expect((await putCover(rid, p.id)).status).toBe(200);
    expect((await delPhoto(p.id)).status).toBe(204);
  });

  it('a member reading a users recipe: GET 200 but upload, delete, cover are 403', async () => {
    const rid = await makeRecipe('users');
    const p = await add(rid);
    as(alice);
    expect((await get(rid)).status).toBe(200);
    expect((await getPhoto(p.id)).status).toBe(200);
    expect((await getPhoto(p.id, '?size=thumb')).status).toBe(200);
    const before = files();
    expect((await upload(rid, await png())).status).toBe(403);
    expect((await delPhoto(p.id)).status).toBe(403);
    expect((await putCover(rid, p.id)).status).toBe(403);
    expect(files()).toEqual(before);
    expect(rows()).toBe(1);
  });

  it('a member on a private recipe gets 404 for everything', async () => {
    const rid = await makeRecipe('private');
    const p = await add(rid);
    as(alice);
    expect((await get(rid)).status).toBe(404);
    expect((await upload(rid, await png())).status).toBe(404);
    expect((await getPhoto(p.id)).status).toBe(404);
    expect((await getPhoto(p.id, '?size=thumb')).status).toBe(404);
    expect((await delPhoto(p.id)).status).toBe(404);
    expect((await putCover(rid, p.id)).status).toBe(404);
    expect(rows()).toBe(1);
  });

  it('unauthenticated is 401 and a cross-origin or missing CSRF header is 403 before the body', async () => {
    const rid = await makeRecipe('users');
    const p = await add(rid);
    as(null);
    expect((await upload(rid, await png())).status).toBe(401);
    expect((await delPhoto(p.id)).status).toBe(401);
    expect((await putCover(rid, p.id)).status).toBe(401);
    expect((await get(rid)).status).toBe(401);
    expect((await getPhoto(p.id)).status).toBe(401);
    as(owner);
    // 403 without reading the body: the stream is never pulled.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled++;
          c.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 },
    );
    const res = await photosPost(
      new Request(base, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'image/png' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
      ctx(rid),
    );
    expect(res.status).toBe(403);
    expect(pulled).toBe(0);
    await stream.cancel();
    expect((await upload(rid, await png(), 'image/png', {})).status).toBe(403);
    expect((await delPhoto(p.id, {})).status).toBe(403);
    expect((await putCover(rid, p.id, {})).status).toBe(403);
    expect(rows()).toBe(1);
  });

  it('unknown recipe or photo is 404; a photo of another recipe via a mismatched recipe id is 404', async () => {
    const a = await makeRecipe('private');
    const b = await makeRecipe('private');
    const pa = await add(a);
    as(owner);
    expect((await upload('nope', await png())).status).toBe(404);
    expect((await getPhoto('nope')).status).toBe(404);
    expect((await delPhoto('nope')).status).toBe(404);
    expect((await putCover(b, pa.id)).status).toBe(404);
    expect((await putCover(a, 'nope')).status).toBe(404);
    expect(listPhotos(db, a)[0]!.isCover).toBe(true);
  });

  it('traversal-looking ids are 404', async () => {
    as(owner);
    for (const id of ['..%2F..%2Fetc%2Fpasswd', '../x', '/etc/passwd']) {
      expect((await getPhoto(id)).status).toBe(404);
      expect((await delPhoto(id)).status).toBe(404);
    }
  });

  it('a stored traversal path in a row is refused on read and on delete', async () => {
    const rid = await makeRecipe('private');
    const secret = join(dir, 'secret.txt');
    writeFileSync(secret, 'top secret');
    const bad = db
      .insert(photo)
      .values({
        recipeId: rid,
        filePath: '../secret.txt',
        thumbPath: '../secret.txt',
        width: 1,
        height: 1,
        isCover: true,
      })
      .returning()
      .get();
    as(owner);
    expect((await getPhoto(bad.id)).status).toBe(404);
    expect((await getPhoto(bad.id, '?size=thumb')).status).toBe(404);
    expect((await delPhoto(bad.id)).status).toBe(204);
    expect(existsSync(secret)).toBe(true);
  });

  it('?size= other than thumb (or repeated) is 400', async () => {
    const rid = await makeRecipe('private');
    const p = await add(rid);
    as(owner);
    for (const q of [
      '?size=',
      '?size=full',
      '?size=100',
      '?size=thumb&size=thumb',
      '?size=THUMB',
    ]) {
      expect((await getPhoto(p.id, q)).status, q).toBe(400);
    }
    expect((await getPhoto(p.id, '?size=thumb')).status).toBe(200);
  });
});

describe('upload size and type', () => {
  it('a wrong content type is 415 before the body is read', async () => {
    const rid = await makeRecipe();
    for (const t of ['text/html', 'application/json', 'multipart/form-data; boundary=x', null]) {
      expect((await upload(rid, await png(), t)).status).toBe(415);
    }
    expect(files()).toEqual([]);
    expect(rows()).toBe(0);
  });

  it('exactly 10 MiB is read, 10 MiB + 1 is 413 and the stream stops within one chunk', async () => {
    const exact = await readCappedBytes(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array(PHOTO_BODY_MAX),
      }),
    );
    expect(exact instanceof Response).toBe(false);
    expect((exact as { bytes: Uint8Array }).bytes.byteLength).toBe(PHOTO_BODY_MAX);

    const CHUNK = 64 * 1024;
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled += CHUNK;
          c.enqueue(new Uint8Array(CHUNK));
        },
      },
      { highWaterMark: 0 },
    );
    const over = await readCappedBytes(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: endless,
        duplex: 'half',
      } as RequestInit),
    );
    expect((over as Response).status).toBe(413);
    // the cap plus at most one chunk (plus one for read-ahead slack) was ever pulled
    expect(pulled).toBeLessThanOrEqual(PHOTO_BODY_MAX + 2 * CHUNK);
    expect(pulled).toBeGreaterThan(PHOTO_BODY_MAX);
  });

  it('413 route: an oversize body leaves nothing on disk or in the db', async () => {
    const rid = await makeRecipe();
    as(owner);
    const res = await upload(rid, new Uint8Array(PHOTO_BODY_MAX + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(files()).toEqual([]);
    expect(rows()).toBe(0);
  });

  it('413 from a declared Content-Length without reading the body', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled++;
        },
      },
      { highWaterMark: 0 },
    );
    const res = await readCappedBytes(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'content-length': String(PHOTO_BODY_MAX + 1) },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    expect((res as Response).status).toBe(413);
    expect(pulled).toBe(0);
  });

  it('a body of exactly 10 MiB (valid image plus padding) is accepted', async () => {
    const rid = await makeRecipe();
    as(owner);
    const img = await jpeg();
    const padded = new Uint8Array(PHOTO_BODY_MAX);
    padded.set(img);
    const res = await upload(rid, padded, 'image/jpeg');
    expect(res.status).toBe(201);
  });

  it('zero-byte is 422 empty_file', async () => {
    const rid = await makeRecipe();
    as(owner);
    const res = await upload(rid, new Uint8Array(0));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors: [{ path: 'file', code: 'empty_file' }] });
  });
});

describe('upload validation: nothing is written for a hostile file', () => {
  const header = async (w: number, h: number) => {
    const b = Buffer.from(await png(1, 1));
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    b.writeUInt32BE(crc32(b.subarray(12, 29)), 29);
    return b;
  };
  it.each([
    [
      'svg',
      'image/svg+xml',
      () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'unsupported_type',
    ],
    [
      'html',
      'image/png',
      () => Buffer.from('<html><script>alert(1)</script></html>'),
      'unsupported_type',
    ],
    ['text', 'image/jpeg', () => Buffer.from('just some text'), 'unsupported_type'],
    [
      'gif (not accepted for uploads)',
      'image/gif',
      () => Buffer.from('GIF89a......'),
      'unsupported_type',
    ],
    [
      'polyglot png header plus script',
      'image/png',
      () =>
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from('<script>1</script>'),
        ]),
      'invalid_image',
    ],
    ['jpeg bytes labelled as png', 'image/png', async () => jpeg(), null],
  ])('%s', async (_n, type, make, codeExpected) => {
    const rid = await makeRecipe();
    as(owner);
    const body = await make();
    const res = await upload(rid, body, type);
    if (codeExpected === null) {
      // The type is only a hint: a real jpeg labelled png is accepted and re-encoded.
      expect(res.status).toBe(201);
      return;
    }
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors: [{ path: 'file', code: codeExpected }] });
    expect(files()).toEqual([]);
    expect(rows()).toBe(0);
  });

  it('truncated image is 422 invalid_image with no residue', async () => {
    const rid = await makeRecipe();
    as(owner);
    const whole = await png(200, 200, '#123');
    const noisy = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: '#000',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    for (const full of [whole, noisy]) {
      const res = await upload(rid, full.subarray(0, Math.floor(full.length / 2)));
      expect(res.status).toBe(422);
      expect(((await res.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe(
        'invalid_image',
      );
    }
    expect(files()).toEqual([]);
    expect(rows()).toBe(0);
  });

  it('decompression bomb (header claims 20000 x 20000, and 5000 x 4000) is 422 too_many_pixels', async () => {
    const rid = await makeRecipe();
    as(owner);
    for (const [w, h] of [
      [20000, 20000],
      [5000, 4000],
    ] as const) {
      const res = await upload(rid, await header(w, h));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ errors: [{ path: 'file', code: 'too_many_pixels' }] });
    }
    expect(files()).toEqual([]);
    expect(rows()).toBe(0);
  });

  it('the directory listing is identical before and after a rejected upload', async () => {
    const rid = await makeRecipe();
    await add(rid);
    const before = files();
    as(owner);
    await upload(rid, Buffer.from('<svg/>'));
    await upload(rid, new Uint8Array(PHOTO_BODY_MAX + 1));
    await upload(rid, await header(20000, 20000));
    expect(files()).toEqual(before);
    expect(rows()).toBe(1);
  });
});

describe('stored result', () => {
  it('writes ULID .webp main and thumb files, relative paths, no original', async () => {
    const rid = await makeRecipe();
    const p = await add(rid, owner, await png(3200, 1600));
    expect(p).toMatchObject({ width: 1600, height: 800, is_cover: true });
    const row = listPhotos(db, rid)[0]!;
    expect(row.filePath).toMatch(/^[0-9A-Z]{26}\.webp$/);
    expect(row.thumbPath).toMatch(/^[0-9A-Z]{26}\.webp$/);
    expect(row.thumbPath).not.toBe(row.filePath);
    expect(files().sort()).toEqual([row.filePath, row.thumbPath].sort());
    const main = await sharp(join(state.dir, row.filePath)).metadata();
    const thumb = await sharp(join(state.dir, row.thumbPath!)).metadata();
    expect([main.format, main.width]).toEqual(['webp', 1600]);
    expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 400, 200]);
  });

  it('serves image/webp with nosniff, private no-cache and an ETag; JSON is private no-store', async () => {
    const rid = await makeRecipe();
    const p = await add(rid);
    as(owner);
    for (const q of ['', '?size=thumb']) {
      const res = await getPhoto(p.id, q);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('private, no-cache');
      expect(res.headers.get('etag')).toMatch(/^"/);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect(meta.format).toBe('webp');
    }
    const thumb = await getPhoto(p.id, '?size=thumb');
    const full = await getPhoto(p.id);
    expect(thumb.headers.get('etag')).not.toBe(full.headers.get('etag'));
    expect((await get(rid)).headers.get('cache-control')).toBe('private, no-store');
    const created = await upload(rid, await png());
    expect(created.headers.get('cache-control')).toBe('private, no-store');
    const bad = await upload(rid, Buffer.from('x'));
    expect(bad.headers.get('cache-control')).toBe('private, no-store');
  });

  it('accepts jpeg, png and webp', async () => {
    const rid = await makeRecipe();
    for (const make of [jpeg, png, webp]) await add(rid, owner, await make());
    expect(listPhotos(db, rid)).toHaveLength(3);
  });

  it('exif and metadata are not stored', async () => {
    const rid = await makeRecipe();
    const withExif = await sharp(await jpeg())
      .withExif({ IFD0: { Copyright: 'gps-owner' } })
      .toBuffer();
    await add(rid, owner, withExif);
    const row = listPhotos(db, rid)[0]!;
    expect((await sharp(join(state.dir, row.filePath)).metadata()).exif).toBeUndefined();
  });
});

describe('ETag and 304', () => {
  it('If-None-Match gives 304 with the headers, a deleted photo is 404, never a stale 304', async () => {
    const rid = await makeRecipe();
    const p = await add(rid);
    as(owner);
    const etag = (await getPhoto(p.id)).headers.get('etag')!;
    const res = await getPhoto(p.id, '', { ...same, 'if-none-match': etag });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await getPhoto(p.id, '', { ...same, 'if-none-match': `W/${etag}` })).status).toBe(304);
    expect((await getPhoto(p.id, '', { ...same, 'if-none-match': '"other"' })).status).toBe(200);
    expect((await getPhoto(p.id, '?size=thumb', { ...same, 'if-none-match': etag })).status).toBe(
      200,
    );
    expect((await delPhoto(p.id)).status).toBe(204);
    expect((await getPhoto(p.id, '', { ...same, 'if-none-match': etag })).status).toBe(404);
  });

  it('a revoked reader gets 404, not 304', async () => {
    const rid = await makeRecipe('users');
    const p = await add(rid);
    as(alice);
    const etag = (await getPhoto(p.id)).headers.get('etag')!;
    db.update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, rid)).run();
    expect((await getPhoto(p.id, '', { ...same, 'if-none-match': etag })).status).toBe(404);
  });

  it('a legacy row without thumb_path serves the main file for ?size=thumb (G1)', async () => {
    const rid = await makeRecipe();
    mkdirSync(state.dir, { recursive: true });
    writeFileSync(join(state.dir, 'LEGACY.webp'), 'legacybytes');
    const row = db
      .insert(photo)
      .values({ recipeId: rid, filePath: 'LEGACY.webp', width: 1, height: 1, isCover: true })
      .returning()
      .get();
    as(owner);
    const res = await getPhoto(row.id, '?size=thumb');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('legacybytes');
    expect(res.headers.get('etag')).toBe(`"${row.id}-full"`);
  });
});

describe('cover rules and limits', () => {
  it('first upload is the cover, set-cover swaps, deleting the cover promotes the next', async () => {
    const rid = await makeRecipe();
    const a = await add(rid);
    const b = await add(rid);
    const c = await add(rid);
    const covers = () =>
      listPhotos(db, rid)
        .filter((p) => p.isCover)
        .map((p) => p.id);
    expect(covers()).toEqual([a.id]);
    as(owner);
    await putCover(rid, c.id);
    expect(covers()).toEqual([c.id]);
    expect((await delPhoto(c.id)).status).toBe(204);
    expect(covers()).toEqual([a.id]);
    expect((await delPhoto(a.id)).status).toBe(204);
    expect(covers()).toEqual([b.id]);
    expect((await delPhoto(b.id)).status).toBe(204);
    expect(covers()).toEqual([]);
    expect(files()).toEqual([]);
  });

  it('the 11th photo is 422 photo_limit and writes nothing', async () => {
    const rid = await makeRecipe();
    for (let i = 0; i < 10; i++) await add(rid);
    const before = files();
    as(owner);
    const res = await upload(rid, await png());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors: [{ path: 'file', code: 'photo_limit' }] });
    expect(files()).toEqual(before);
    expect(rows()).toBe(10);
  });

  it('delete removes both files after commit', async () => {
    const rid = await makeRecipe();
    const p = await add(rid);
    expect(files()).toHaveLength(2);
    as(owner);
    await delPhoto(p.id);
    expect(files()).toEqual([]);
  });

  it('deleting the recipe removes main and thumb files', async () => {
    const rid = await makeRecipe();
    await add(rid);
    await add(rid);
    as(owner);
    const res = await recipeDelete(jsonReq('DELETE'), pctx(rid));
    expect(res.status).toBe(204);
    expect(files()).toEqual([]);
  });
});

describe('concurrency and atomicity', () => {
  it('12 simultaneous uploads: exactly 10 stored, one cover, 2 refused by the in-transaction cap', async () => {
    const rid = await makeRecipe();
    const decode = createConcurrencyLimiter(1);
    const body = await png();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        uploadPhotoFor(db, owner, rid, body, { uploadsDir: state.dir, decode }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok && r.status === 422)).toHaveLength(2);
    const rowsNow = listPhotos(db, rid);
    expect(rowsNow).toHaveLength(10);
    expect(rowsNow.filter((p) => p.isCover)).toHaveLength(1);
    expect(files()).toHaveLength(20);
    expect(new Set(rowsNow.map((p) => p.position)).size).toBe(10);
  });

  it('a burst through the route uses the bounded queue: only 201 or 503, files match rows', async () => {
    const rid = await makeRecipe();
    as(owner);
    const body = await png();
    const results = await Promise.all(Array.from({ length: 12 }, () => upload(rid, body)));
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 503)).toBe(true);
    expect(statuses.filter((s) => s === 503).length).toBeGreaterThan(0);
    const n = statuses.filter((s) => s === 201).length;
    expect(listPhotos(db, rid)).toHaveLength(n);
    expect(files()).toHaveLength(n * 2);
    for (const r of results.filter((r) => r.status === 503)) {
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    }
  });

  it('decodes run one at a time through the limiter seam', async () => {
    const rid = await makeRecipe();
    const limiter = createConcurrencyLimiter(1, { maxQueue: 8 });
    let active = 0;
    let max = 0;
    const decode = <T>(fn: () => Promise<T>) =>
      limiter(async () => {
        active++;
        max = Math.max(max, active);
        try {
          return await fn();
        } finally {
          active--;
        }
      });
    const body = await png();
    const out = await Promise.all(
      Array.from({ length: 4 }, () =>
        uploadPhotoFor(db, owner, rid, body, { uploadsDir: state.dir, decode }),
      ),
    );
    expect(out.every((r) => r.ok)).toBe(true);
    expect(max).toBe(1);
  });

  it('a saturated limiter answers 503 with Retry-After and writes nothing (seam and route)', async () => {
    const rid = await makeRecipe();
    const limiter = createConcurrencyLimiter(1, { maxQueue: 0, retryAfterSec: 7 });
    let release!: () => void;
    const held = limiter(() => new Promise<void>((r) => (release = r)));
    const direct = await uploadPhotoFor(db, owner, rid, await png(), {
      uploadsDir: state.dir,
      decode: limiter,
    });
    expect(direct).toEqual({ ok: false, status: 503, retryAfterSec: 7 });
    // route-level: the process-wide limiter registry is the seam
    (globalThis as { __importDecodeLimiter?: unknown }).__importDecodeLimiter = limiter;
    as(owner);
    const res = await upload(rid, await png());
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('7');
    expect(files()).toEqual([]);
    expect(rows()).toBe(0);
    release();
    await held;
  });

  it('a forced DB failure after the files were written unlinks them and surfaces an error', async () => {
    const rid = await makeRecipe();
    db.$client.exec(
      `CREATE TRIGGER photo_fail BEFORE INSERT ON photo BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    as(owner);
    await expect(upload(rid, await png())).rejects.toThrow();
    expect(files()).toEqual([]);
    expect(rows()).toBe(0);
  });

  it('a forced unlink failure after commit does not fail the delete', async () => {
    const rid = await makeRecipe();
    const p = await add(rid);
    const row = listPhotos(db, rid)[0]!;
    // Replace the main file by a non-empty directory: rm without recursive fails.
    rmSync(join(state.dir, row.filePath));
    mkdirSync(join(state.dir, row.filePath));
    writeFileSync(join(state.dir, row.filePath, 'x'), 'x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    as(owner);
    expect((await delPhoto(p.id)).status).toBe(204);
    expect(rows()).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a recipe deleted during the upload leaves no files', async () => {
    const rid = await makeRecipe();
    const body = await png();
    const decode = async <T>(fn: () => Promise<T>) => {
      const r = await fn();
      db.delete(recipe).where(eq(recipe.id, rid)).run();
      return r;
    };
    const res = await uploadPhotoFor(db, owner, rid, body, { uploadsDir: state.dir, decode });
    expect(res).toEqual({ ok: false, status: 404 });
    expect(files()).toEqual([]);
  });
});

describe('recipe responses and recipe.updated_at', () => {
  it('ApiRecipe carries photos, list items carry cover_photo_id, both private no-store', async () => {
    const rid = await makeRecipe('users');
    const other = await makeRecipe('users');
    const a = await add(rid);
    await add(rid);
    as(alice);
    const res = await recipeGet(jsonReq('GET'), pctx(rid));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const rec = (await res.json()) as { photos: P[] };
    expect(rec.photos.map((p) => [p.id, p.is_cover])).toEqual([
      [a.id, true],
      [expect.any(String), false],
    ]);
    expect(Object.keys(rec.photos[0]!).sort()).toEqual(['height', 'id', 'is_cover', 'width']);
    const list = await listGet(jsonReq('GET'));
    expect(list.headers.get('cache-control')).toBe('private, no-store');
    const items = (
      (await list.json()) as { recipes: { id: string; cover_photo_id: string | null }[] }
    ).recipes;
    expect(items.find((i) => i.id === rid)!.cover_photo_id).toBe(a.id);
    expect(items.find((i) => i.id === other)!.cover_photo_id).toBeNull();
  });

  it('upload, cover and delete leave recipe.updated_at alone; a stale grid base still saves', async () => {
    const rid = await makeRecipe('users');
    const before = db.select().from(recipe).where(eq(recipe.id, rid)).get()!;
    const a = await add(rid);
    const b = await add(rid);
    as(owner);
    await putCover(rid, b.id);
    await delPhoto(a.id);
    const after = db.select().from(recipe).where(eq(recipe.id, rid)).get()!;
    expect(after.updatedAt).toBe(before.updatedAt);
    const got = (await (await recipeGet(jsonReq('GET'), pctx(rid))).json()) as {
      sections: unknown[];
      photos: P[];
    };
    const res = await gridPut(
      new Request('http://localhost:3100/api/recipes/x/grid', {
        method: 'PUT',
        headers: { ...same, 'content-type': 'application/json' },
        body: JSON.stringify({ base_updated_at: before.updatedAt, sections: got.sections }),
      }),
      pctx(rid),
    );
    expect(res.status).toBe(200);
    expect(listPhotos(db, rid).map((p) => p.id)).toEqual([b.id]);
  });
});

describe('Save a copy', () => {
  const copy = async (rid: string, by: User) => {
    as(by);
    const res = await copyPost(
      new Request('http://localhost:3100/x', { method: 'POST', headers: same }),
      pctx(rid),
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  it('gives the copy its own files and rows; deleting the original photo keeps the copy intact', async () => {
    const rid = await makeRecipe('users');
    const a = await add(rid);
    const b = await add(rid);
    as(owner);
    await putCover(rid, b.id);
    const cid = await copy(rid, alice);
    const src = listPhotos(db, rid);
    const dup = listPhotos(db, cid);
    expect(dup).toHaveLength(2);
    expect(dup.map((p) => p.isCover)).toEqual([false, true]);
    const srcPaths = new Set(src.flatMap((p) => [p.filePath, p.thumbPath]));
    for (const p of dup) {
      expect(srcPaths.has(p.filePath)).toBe(false);
      expect(srcPaths.has(p.thumbPath)).toBe(false);
      expect(existsSync(join(state.dir, p.filePath))).toBe(true);
      expect(existsSync(join(state.dir, p.thumbPath!))).toBe(true);
    }
    expect(files()).toHaveLength(8);
    as(owner);
    await delPhoto(a.id);
    await delPhoto(b.id);
    as(alice);
    for (const p of dup) expect((await getPhoto(p.id)).status).toBe(200);
    expect(files()).toHaveLength(4);
  });

  it('a recipe without photos copies as before', async () => {
    const rid = await makeRecipe('users');
    const cid = await copy(rid, alice);
    expect(listPhotos(db, cid)).toEqual([]);
  });

  it('a missing source file is skipped; the recipe copy still succeeds', async () => {
    const rid = await makeRecipe('users');
    await add(rid);
    await add(rid);
    const [first] = listPhotos(db, rid);
    rmSync(join(state.dir, first!.filePath));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cid = await copy(rid, alice);
    warn.mockRestore();
    const dup = listPhotos(db, cid);
    expect(dup).toHaveLength(1);
    expect(dup[0]!.isCover).toBe(true);
  });
});

describe('upload gate, read timeout and image headers (AppSec M1, L1, L2)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  /** A POST whose body the test feeds by hand, so the request stays in flight on demand. */
  function streamed(rid: string) {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
      },
    });
    const res = photosPost(
      new Request(base, {
        method: 'POST',
        headers: { ...same, 'content-type': 'image/png' },
        body,
        duplex: 'half',
      } as RequestInit),
      ctx(rid),
    );
    return { res, ctrl };
  }
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it('a full gate answers 503 + Retry-After + no-store, and the slot frees after completion', async () => {
    restore = configureUploads({ limit: 2 });
    const rid = await makeRecipe();
    as(owner);
    const a = streamed(rid);
    const b = streamed(rid);
    await tick();
    expect(uploadsInFlight()).toBe(2);
    const full = await upload(rid, await png());
    expect(full.status).toBe(503);
    expect(full.headers.get('retry-after')).toBe('5');
    expect(full.headers.get('cache-control')).toMatch(/no-store/);
    expect(await full.json()).toEqual({ error: 'busy' });
    expect(rows()).toBe(0);

    a.ctrl.enqueue(new Uint8Array(await png()));
    a.ctrl.close();
    expect((await a.res).status).toBe(201);
    expect(uploadsInFlight()).toBe(1);
    expect((await upload(rid, await png())).status).toBe(201); // slot is reusable
    b.ctrl.close(); // empty body -> 422, still released
    expect((await b.res).status).toBe(422);
    expect(uploadsInFlight()).toBe(0);
  });

  it('slots are released after 413, 415, 422 and a thrown error', async () => {
    restore = configureUploads({ limit: 1 });
    const rid = await makeRecipe();
    as(owner);
    expect((await upload(rid, new Uint8Array(PHOTO_BODY_MAX + 1))).status).toBe(413);
    expect(uploadsInFlight()).toBe(0);
    expect((await upload(rid, await png(), 'text/html')).status).toBe(415);
    expect(uploadsInFlight()).toBe(0);
    expect((await upload(rid, new TextEncoder().encode('not an image'))).status).toBe(422);
    expect(uploadsInFlight()).toBe(0);
    const boom = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error('socket reset'));
      },
    });
    await expect(
      photosPost(
        new Request(base, {
          method: 'POST',
          headers: { ...same, 'content-type': 'image/png' },
          body: boom,
          duplex: 'half',
        } as RequestInit),
        ctx(rid),
      ),
    ).rejects.toThrow();
    expect(uploadsInFlight()).toBe(0);
    expect((await upload(rid, await png())).status).toBe(201);
  });

  it('auth and access failures never take a slot', async () => {
    restore = configureUploads({ limit: 0 });
    const rid = await makeRecipe('private');
    as(null);
    expect((await upload(rid, await png())).status).toBe(401);
    as(alice);
    expect((await upload(rid, await png())).status).toBe(404);
    as(owner);
    expect((await upload(rid, await png())).status).toBe(503);
  });

  it('a stalled body times out with 408 request_timeout and frees the slot', async () => {
    restore = configureUploads({ limit: 1, readTimeoutMs: 50 });
    const rid = await makeRecipe();
    as(owner);
    const a = streamed(rid);
    const res = await a.res;
    expect(res.status).toBe(408);
    expect(await res.json()).toEqual({ error: 'request_timeout' });
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(uploadsInFlight()).toBe(0);
    expect(rows()).toBe(0);
  });

  it('readCappedBytes honours an explicit timeout and a fast body is unaffected', async () => {
    const slow = new ReadableStream<Uint8Array>({});
    const res = await readCappedBytes(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: slow,
        duplex: 'half',
      } as RequestInit),
      PHOTO_BODY_MAX,
      { timeoutMs: 30 },
    );
    expect((res as Response).status).toBe(408);
    const ok = await readCappedBytes(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array([1, 2, 3]),
      }),
      PHOTO_BODY_MAX,
      { timeoutMs: 1000 },
    );
    expect(Array.from((ok as { bytes: Uint8Array }).bytes)).toEqual([1, 2, 3]);
  });

  it('a lying Content-Length is still capped while streaming', async () => {
    const CHUNK = 64 * 1024;
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled += CHUNK;
          c.enqueue(new Uint8Array(CHUNK));
        },
      },
      { highWaterMark: 0 },
    );
    const res = await readCappedBytes(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'content-length': '10' },
        body: endless,
        duplex: 'half',
      } as RequestInit),
    );
    expect((res as Response).status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(PHOTO_BODY_MAX + 2 * CHUNK);
  });

  it('a valid Content-Length gives the exact bytes (single preallocated buffer)', async () => {
    const data = new Uint8Array(200_000).map((_, i) => i % 251);
    const res = await readCappedBytes(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'content-length': String(data.byteLength) },
        body: data,
      }),
    );
    const bytes = (res as { bytes: Uint8Array }).bytes;
    expect(bytes.byteLength).toBe(data.byteLength);
    expect(Buffer.from(bytes).equals(Buffer.from(data))).toBe(true);
  });

  it('GET /api/photos/[id]: image headers on 200 and 304, no-store on 401/404/400 (GET is never CSRF-rejected)', async () => {
    const rid = await makeRecipe();
    const p = await add(rid);
    as(owner);
    const ok = await getPhoto(p.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(ok.headers.get('content-disposition')).toBe('inline; filename="photo.webp"');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    const nm = await getPhoto(p.id, '', { ...same, 'if-none-match': `"${p.id}-full"` });
    expect(nm.status).toBe(304);
    expect(nm.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");

    const nostore = (r: Response) => expect(r.headers.get('cache-control')).toMatch(/no-store/);
    as(null);
    const r401 = await getPhoto(p.id);
    expect(r401.status).toBe(401);
    nostore(r401);
    as(owner);
    const r404 = await getPhoto('nope');
    expect(r404.status).toBe(404);
    nostore(r404);
    const r400 = await getPhoto(p.id, '?size=huge');
    expect(r400.status).toBe(400);
    nostore(r400);
  });
});
