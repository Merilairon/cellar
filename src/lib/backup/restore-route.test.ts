import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { count } from 'drizzle-orm';
import { ulid } from 'ulid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/connection';
import { note, photo, rating, recipe, user } from '@/lib/db/schema';
import { buildBackup } from './export';
import { normalizeDoc, viaJson, webp } from './restore-test-util';
import { beginApply, listStages, registerStage, resetStagingForTests } from './staging';
import {
  addNote,
  addRating,
  maximalRecipe,
  memDb,
  mkUser,
  saveInput,
  SAMPLE_INPUTS,
  type U,
} from './test-fixtures';
import { MAX_PHOTO_BYTES } from './unzip';
import { rawZip } from './unzip-test-util';
import { BACKUP_ENTRY } from './zip';
import { collect } from './zip-test-util';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown }));
const env = vi.hoisted(() => ({
  BASE_URL: 'http://localhost:3100',
  UPLOADS_DIR: '',
  RESTORE_DIR: '',
  RESTORE_BODY_MAX: 268_435_456,
  RATE_LIMIT_EXPORT_MAX: 100,
  RATE_LIMIT_EXPORT_WINDOW_SEC: 3600,
  RATE_LIMIT_RESTORE_MAX: 10,
  RATE_LIMIT_RESTORE_WINDOW_SEC: 3600,
}));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => env }));

import { POST as stagePost } from '@/app/api/import/backup/route';
import { DELETE as discardDelete } from '@/app/api/import/backup/[id]/route';
import { POST as applyPost } from '@/app/api/import/backup/[id]/apply/route';
import { limits } from '@/app/api/import/backup/shared';
import { GET as exportGet } from '@/app/api/export/route';

const ORIGIN = 'http://localhost:3100';
let db: Db;
let root: string;
let me: U;
let other: U;
let admin: U;
const registry = globalThis as unknown as {
  __rateLimiters?: Map<string, unknown>;
  __exportInFlight?: Map<string, number>;
};

beforeEach(() => {
  resetStagingForTests();
  registry.__rateLimiters?.clear();
  registry.__exportInFlight?.clear();
  root = mkdtempSync(join(tmpdir(), 'restore-route-'));
  env.UPLOADS_DIR = join(root, 'uploads');
  env.RESTORE_DIR = join(root, 'restore');
  env.RESTORE_BODY_MAX = 268_435_456;
  env.RATE_LIMIT_RESTORE_MAX = 10;
  limits.idleMs = 30_000;
  db = memDb();
  state.db = db;
  me = mkUser(db, 'me@x.test');
  other = mkUser(db, 'other@x.test');
  admin = mkUser(db, 'admin@x.test', 'admin');
  state.current = me;
});
afterEach(() => {
  vi.useRealTimers();
  db.$client.close();
  rmSync(root, { recursive: true, force: true });
});

const url = 'http://localhost:3100/api/import/backup';
const headers = (type: string, extra: Record<string, string> = {}) => ({
  'content-type': type,
  origin: ORIGIN,
  ...extra,
});
const stage = (body: Buffer | string, type = 'application/json', extra = {}) =>
  stagePost(
    new Request(url, { method: 'POST', headers: headers(type, extra), body: body as BodyInit }),
  );
const applyReq = (
  id: string,
  body: unknown = { strategy: 'skip' },
  h = headers('application/json'),
) =>
  applyPost(
    new Request(`${url}/${id}/apply`, { method: 'POST', headers: h, body: JSON.stringify(body) }),
    {
      params: Promise.resolve({ id }),
    },
  );
const del = (id: string, h: Record<string, string> = { origin: ORIGIN }) =>
  discardDelete(new Request(`${url}/${id}`, { method: 'DELETE', headers: h }), {
    params: Promise.resolve({ id }),
  });

const ls = (d: string) => (existsSync(d) ? readdirSync(d).sort() : []);
const snapshot = () => ({
  rows: {
    recipes: db.select({ n: count() }).from(recipe).get()!.n,
    notes: db.select({ n: count() }).from(note).get()!.n,
    ratings: db.select({ n: count() }).from(rating).get()!.n,
    photos: db.select({ n: count() }).from(photo).get()!.n,
    users: db.select({ n: count() }).from(user).get()!.n,
  },
  uploads: ls(env.UPLOADS_DIR),
  restore: ls(env.RESTORE_DIR),
});

/** A valid own-scope backup of two recipes built from a throwaway source instance. */
function ownBackup(titles = ['Alpha', 'Beta']): string {
  const src = memDb();
  const u = mkUser(src, 'src@x.test');
  titles.forEach((t, i) => saveInput(src, u.id, { ...SAMPLE_INPUTS[i % 2]!, title: t }));
  const doc = buildBackup(src, u, { all: false });
  src.$client.close();
  return JSON.stringify(doc);
}
function allBackup(): string {
  const src = memDb();
  const a = mkUser(src, 'admin@x.test', 'admin');
  const m = mkUser(src, 'me@x.test');
  saveInput(src, m.id, { ...SAMPLE_INPUTS[0], title: 'Mine' });
  saveInput(src, a.id, { ...SAMPLE_INPUTS[1], title: 'Admins' });
  const doc = buildBackup(src, a, { all: true });
  src.$client.close();
  return JSON.stringify(doc);
}

describe('POST /api/import/backup: authorization and media type', () => {
  it('401 without a session, CSRF 403 before the session is looked at', async () => {
    state.current = null;
    expect((await stage(ownBackup())).status).toBe(401);
    state.current = me;
    const noOrigin = await stagePost(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(noOrigin.status).toBe(403);
    const crossSite = await stagePost(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
        body: '{}',
      }),
    );
    expect(crossSite.status).toBe(403);
    expect(snapshot().uploads).toEqual([]);
  });

  it('415 for any other content type, with a message', async () => {
    for (const type of ['text/plain', 'application/octet-stream', 'multipart/form-data', '']) {
      const res = await stage('{}', type);
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({
        error: 'unsupported_media_type',
        message: expect.any(String),
      });
    }
    expect(snapshot().restore).toEqual([]);
  });

  it('accepts the type with a charset parameter', async () => {
    expect((await stage(ownBackup(), 'application/json; charset=utf-8')).status).toBe(201);
  });
});

describe('POST /api/import/backup: stage', () => {
  it('201 with id, kind, expiry and a preview; no DB writes; the file is staged', async () => {
    const before = snapshot();
    const res = await stage(ownBackup());
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      kind: 'json',
      preview: {
        scope: 'own',
        recipes: 2,
        photos: 0,
        conflicts: [],
        unknown_users: [],
        notes_skipped: 0,
        ratings_skipped: 0,
      },
    });
    expect(Date.parse(body.expires_at) - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(snapshot().rows).toEqual(before.rows);
    expect(snapshot().uploads).toEqual([]);
    expect(snapshot().restore).toEqual([`${body.id}.json`]);
  });

  it("reports conflicts against the caller's own recipes", async () => {
    saveInput(db, me.id, { ...SAMPLE_INPUTS[0], title: ' alpha ' });
    saveInput(db, other.id, { ...SAMPLE_INPUTS[0], title: 'Beta' });
    const body = await (await stage(ownBackup())).json();
    expect(body.preview.conflicts).toEqual([{ title: 'Alpha', reason: 'same_title' }]);
  });

  it('a zip upload is staged as a zip and its photo count is previewed', async () => {
    const doc = JSON.parse(ownBackup(['Alpha']));
    const name = `photos/${ulid()}.webp`;
    doc.recipes[0].photos = [
      { position: 0, is_cover: true, width: 64, height: 48, file: name, thumb: null },
    ];
    const zip = rawZip([
      { name: BACKUP_ENTRY, data: Buffer.from(JSON.stringify(doc)), method: 8 },
      { name, data: await webp() },
    ]);
    const res = await stage(zip, 'application/zip');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ kind: 'zip', preview: { photos: 1 } });
    expect(snapshot().restore).toEqual([`${body.id}.zip`]);
  });

  it('a new stage replaces the previous one of the same user', async () => {
    const a = await (await stage(ownBackup())).json();
    const b = await (await stage(ownBackup())).json();
    expect(snapshot().restore).toEqual([`${b.id}.json`]);
    expect((await applyReq(a.id)).status).toBe(404);
  });

  it('403 when a member uploads a scope all document; admin may', async () => {
    const before = snapshot();
    const res = await stage(allBackup());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden', message: expect.any(String) });
    expect(snapshot()).toEqual(before);
    state.current = admin;
    const ok = await stage(allBackup());
    expect(ok.status).toBe(201);
    expect((await ok.json()).preview.scope).toBe('all');
  });

  it('409 while an apply of this user is running; the upload leaves no file', async () => {
    const staged = await (await stage(ownBackup())).json();
    const s = listStages().find((x) => x.id === staged.id)!;
    const lease = beginApply(s);
    const res = await stage(ownBackup());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('restore_in_progress');
    expect(snapshot().restore).toEqual([`${staged.id}.json`]);
    if (lease !== 'busy') lease.end();
  });
});

describe('POST /api/import/backup: rejected uploads change nothing', () => {
  async function expectRejected(
    run: () => Promise<Response>,
    status: number,
    code: string,
  ): Promise<Record<string, unknown>> {
    const before = snapshot();
    const res = await run();
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe(code);
    expect(typeof body.message).toBe('string');
    expect(snapshot()).toEqual(before); // row counts, uploads and restore directories identical
    expect(listStages()).toEqual([]);
    return body;
  }

  const doc = () => JSON.parse(ownBackup(['Alpha']));
  const zipOf = (...entries: Parameters<typeof rawZip>[0]) => rawZip(entries);
  const manifest = (d: unknown = doc()) => ({
    name: BACKUP_ENTRY,
    data: Buffer.from(JSON.stringify(d)),
  });

  it('version 2: the upgrade message with the found version', async () => {
    const body = await expectRejected(
      () => stage(JSON.stringify({ ...doc(), version: 2 })),
      422,
      'backup_version_unsupported',
    );
    expect(body.found).toBe(2);
    expect(body.message).toBe(
      'This backup was made by a newer Cellar. Upgrade this instance first.',
    );
  });

  it('version 0 and a string version: generic unsupported text, found echoed safely', async () => {
    const zero = await expectRejected(
      () => stage(JSON.stringify({ ...doc(), version: 0 })),
      422,
      'backup_version_unsupported',
    );
    expect(zero.found).toBe(0);
    expect(zero.message).not.toMatch(/newer Cellar/);
    const text = await expectRejected(
      () => stage(JSON.stringify({ ...doc(), version: '<script>' })),
      422,
      'backup_version_unsupported',
    );
    expect(text.found).toBe('string');
  });

  it('schema failures: at most 10 error strings', async () => {
    const d = doc();
    d.recipes = Array.from({ length: 30 }, () => ({ title: 5 }));
    const body = await expectRejected(() => stage(JSON.stringify(d)), 422, 'backup_invalid');
    expect((body.errors as string[]).length).toBeLessThanOrEqual(10);
    expect((body.errors as string[]).length).toBeGreaterThan(0);
  });

  it('syntax errors, a JSON array, an empty body and invalid UTF-8', async () => {
    await expectRejected(() => stage('{not json'), 422, 'backup_invalid');
    await expectRejected(() => stage('[]'), 422, 'backup_invalid');
    await expectRejected(() => stage(''), 422, 'backup_invalid');
    await expectRejected(() => stage(Buffer.from([0x7b, 0xff, 0xfe, 0x7d])), 422, 'backup_invalid');
  });

  it('a __proto__ key anywhere in the document', async () => {
    const text = JSON.stringify(doc()).replace(
      '"version":1',
      '"version":1,"__proto__":{"admin":true}',
    );
    await expectRejected(() => stage(text), 422, 'backup_invalid');
  });

  it('a zip without backup.json', async () => {
    await expectRejected(
      () =>
        stage(zipOf({ name: `photos/${ulid()}.webp`, data: Buffer.from('x') }), 'application/zip'),
      422,
      'backup_zip_invalid',
    );
  });

  it('a zip with an entry outside photos/<ulid>.webp', async () => {
    await expectRejected(
      () =>
        stage(zipOf(manifest(), { name: 'evil.sh', data: Buffer.from('x') }), 'application/zip'),
      422,
      'backup_zip_invalid',
    );
  });

  it('a zip entry whose declared size exceeds the cap', async () => {
    await expectRejected(
      () =>
        stage(
          zipOf(manifest(), {
            name: `photos/${ulid()}.webp`,
            data: Buffer.from('x'),
            usize: MAX_PHOTO_BYTES + 1,
            csize: MAX_PHOTO_BYTES + 1,
          }),
          'application/zip',
        ),
      422,
      'backup_zip_invalid',
    );
  });

  it('a zip with 60 001 entries', async () => {
    // Fixed valid names (a counter in Crockford base32) instead of 60 001 ulid() calls.
    const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const fastName = (i: number) => {
      let tail = '';
      for (let n = i, k = 0; k < 6; k++, n = Math.floor(n / 32)) tail = crockford[n % 32]! + tail;
      return `photos/01HZX000000000000000${tail}.webp`;
    };
    const entries = Array.from({ length: 60_001 }, (_, i) => ({
      name: fastName(i),
      data: Buffer.alloc(0),
    }));
    await expectRejected(
      () => stage(rawZip([manifest(), ...entries]), 'application/zip'),
      422,
      'backup_zip_invalid',
    );
  }, 30_000);

  it('not a zip at all, and a zip whose manifest is not valid JSON', async () => {
    await expectRejected(
      () => stage(Buffer.from('plain text'), 'application/zip'),
      422,
      'backup_zip_invalid',
    );
    await expectRejected(
      () => stage(zipOf({ name: BACKUP_ENTRY, data: Buffer.from('{oops') }), 'application/zip'),
      422,
      'backup_invalid',
    );
  });

  it('a zip whose manifest is a lying deflate bomb', async () => {
    const bomb = Buffer.alloc(30 * 1024 * 1024);
    await expectRejected(
      () => stage(zipOf({ name: BACKUP_ENTRY, data: bomb, method: 8 }), 'application/zip'),
      422,
      'backup_zip_invalid',
    );
  });

  it('413 on the declared Content-Length, before any file exists', async () => {
    env.RESTORE_BODY_MAX = 2048;
    await expectRejected(() => stage('x'.repeat(5000)), 413, 'backup_too_large');
  });

  it('413 on the declared Content-Length without reading a single byte of the body', async () => {
    env.RESTORE_BODY_MAX = 2048;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled++;
          c.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 },
    );
    await expectRejected(
      () =>
        stagePost(
          new Request(url, {
            method: 'POST',
            headers: headers('application/json', { 'content-length': '5000' }),
            body,
            duplex: 'half',
          } as RequestInit),
        ),
      413,
      'backup_too_large',
    );
    expect(pulled).toBe(0);
  });

  it('413 while streaming without a Content-Length: the partial file is removed', async () => {
    env.RESTORE_BODY_MAX = 4096;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 64) return c.close();
        sent++;
        c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
      },
    });
    await expectRejected(
      () =>
        stagePost(
          new Request(url, {
            method: 'POST',
            headers: headers('application/json'),
            body,
            duplex: 'half',
          } as RequestInit),
        ),
      413,
      'backup_too_large',
    );
    expect(sent).toBeLessThan(10); // the stream was cancelled, not drained
  });

  it('a JSON upload is capped at 16 MiB even when RESTORE_BODY_MAX is larger', async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ >= 100) return c.close();
        c.enqueue(chunk);
      },
    });
    await expectRejected(
      () =>
        stagePost(
          new Request(url, {
            method: 'POST',
            headers: headers('application/json'),
            body,
            duplex: 'half',
          } as RequestInit),
        ),
      413,
      'backup_too_large',
    );
  });

  it('408 when the sender stalls; the partial file is removed', async () => {
    limits.idleMs = 30;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"version"'));
      },
      pull: () => new Promise(() => undefined),
    });
    await expectRejected(
      () =>
        stagePost(
          new Request(url, {
            method: 'POST',
            headers: headers('application/json'),
            body,
            duplex: 'half',
          } as RequestInit),
        ),
      408,
      'request_timeout',
    );
  });
});

describe('POST /api/import/backup: per-user restore limit', () => {
  it('the 11th stage in the window is 429 with Retry-After and a message; others are unaffected', async () => {
    for (let i = 0; i < 10; i++) expect((await stage(ownBackup())).status).toBe(201);
    const res = await stage(ownBackup());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({
      error: 'rate_limited',
      message: 'Too many restore uploads. Try again later.',
    });
    state.current = other;
    expect((await stage(ownBackup())).status).toBe(201);
  });

  it('a 415, a 409 and a declared-length 413 give the quota back', async () => {
    env.RATE_LIMIT_RESTORE_MAX = 2;
    for (let i = 0; i < 5; i++) expect((await stage('{}', 'text/plain')).status).toBe(415);
    const staged = await (await stage(ownBackup())).json();
    const lease = beginApply(listStages().find((x) => x.id === staged.id)!);
    for (let i = 0; i < 5; i++) expect((await stage(ownBackup())).status).toBe(409);
    if (lease !== 'busy') lease.end();
    env.RESTORE_BODY_MAX = 10;
    for (let i = 0; i < 5; i++) {
      const r = await stage('x'.repeat(50), 'application/json', { 'content-length': '50' });
      expect(r.status).toBe(413);
    }
    env.RESTORE_BODY_MAX = 268_435_456;
    expect((await stage(ownBackup())).status).toBe(201); // second and last counted upload
    expect((await stage(ownBackup())).status).toBe(429);
  });

  it('401 and CSRF 403 never touch the quota', async () => {
    env.RATE_LIMIT_RESTORE_MAX = 1;
    state.current = null;
    for (let i = 0; i < 3; i++) expect((await stage(ownBackup())).status).toBe(401);
    state.current = me;
    for (let i = 0; i < 3; i++) {
      const res = await stagePost(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      );
      expect(res.status).toBe(403);
    }
    expect((await stage(ownBackup())).status).toBe(201);
  });

  it('a rejected 422 upload that was streamed does use the quota', async () => {
    env.RATE_LIMIT_RESTORE_MAX = 1;
    expect((await stage('not json')).status).toBe(422);
    expect((await stage(ownBackup())).status).toBe(429);
  });
});

describe('response headers on the restore routes (the proxy does not run on them)', () => {
  const expectHardened = (res: Response) => {
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  };

  it('stage: 201, 401 and 403 (CSRF)', async () => {
    expectHardened(await stage(ownBackup()));
    state.current = null;
    const unauth = await stage(ownBackup());
    expect(unauth.status).toBe(401);
    expectHardened(unauth);
    state.current = me;
    const csrf = await stagePost(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(csrf.status).toBe(403);
    expectHardened(csrf);
  });

  it('apply: 200, 401 and 403 (CSRF)', async () => {
    const staged = await (await stage(ownBackup())).json();
    state.current = null;
    const unauth = await applyReq(staged.id);
    expect(unauth.status).toBe(401);
    expectHardened(unauth);
    state.current = me;
    const csrf = await applyReq(staged.id, { strategy: 'skip' }, {
      'content-type': 'application/json',
    } as ReturnType<typeof headers>);
    expect(csrf.status).toBe(403);
    expectHardened(csrf);
    const ok = await applyReq(staged.id);
    expect(ok.status).toBe(200);
    expectHardened(ok);
  });

  it('delete: 204, 401 and 403 (CSRF)', async () => {
    const staged = await (await stage(ownBackup())).json();
    state.current = null;
    const unauth = await del(staged.id);
    expect(unauth.status).toBe(401);
    expectHardened(unauth);
    state.current = me;
    const csrf = await del(staged.id, {});
    expect(csrf.status).toBe(403);
    expectHardened(csrf);
    const ok = await del(staged.id);
    expect(ok.status).toBe(204);
    expectHardened(ok);
  });
});

describe('apply: strategy body idle timeout', () => {
  it('408 when the sender stalls; the stage survives', async () => {
    const staged = await (await stage(ownBackup())).json();
    limits.idleMs = 30;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"strat'));
      },
      pull: () => new Promise(() => undefined),
    });
    const res = await applyPost(
      new Request(`${url}/${staged.id}/apply`, {
        method: 'POST',
        headers: headers('application/json'),
        body,
        duplex: 'half',
      } as RequestInit),
      { params: Promise.resolve({ id: staged.id }) },
    );
    expect(res.status).toBe(408);
    expect(await res.json()).toMatchObject({ error: 'request_timeout' });
    expect(listStages().map((s) => s.id)).toEqual([staged.id]);
  });
});

describe('apply and discard', () => {
  it('apply: 200 with the counters, no-store, the staged file and registry entry gone', async () => {
    const staged = await (await stage(ownBackup())).json();
    const res = await applyReq(staged.id, { strategy: 'skip' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      imported: 2,
      skipped: 0,
      renamed: 0,
      notes_restored: 0,
      notes_skipped: 0,
      ratings_restored: 0,
      ratings_skipped: 0,
      photos_restored: 0,
      photos_failed: 0,
      failed_at: null,
    });
    expect(snapshot().restore).toEqual([]);
    expect(listStages()).toEqual([]);
    expect(
      db
        .select()
        .from(recipe)
        .all()
        .every((r) => r.ownerId === me.id),
    ).toBe(true);
    expect((await applyReq(staged.id)).status).toBe(404); // single use
  });

  it('skip and rename through the routes', async () => {
    saveInput(db, me.id, { ...SAMPLE_INPUTS[0], title: 'alpha' });
    const first = await (await stage(ownBackup())).json();
    expect(await (await applyReq(first.id, { strategy: 'skip' })).json()).toMatchObject({
      imported: 1,
      skipped: 1,
    });
    const second = await (await stage(ownBackup())).json();
    expect(await (await applyReq(second.id, { strategy: 'rename' })).json()).toMatchObject({
      imported: 2,
      renamed: 2,
    });
    expect(
      db
        .select({ t: recipe.title })
        .from(recipe)
        .all()
        .map((r) => r.t)
        .sort(),
    ).toEqual(['Alpha (restored)', 'Beta', 'Beta (restored)', 'alpha']);
  });

  it('400 invalid_strategy keeps the stage; bad bodies are 400 too', async () => {
    const staged = await (await stage(ownBackup())).json();
    for (const body of [{ strategy: 'overwrite' }, {}, { strategy: 1 }, null, []]) {
      const res = await applyReq(staged.id, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'invalid_strategy',
        message: expect.any(String),
      });
    }
    const garbage = await applyPost(
      new Request(`${url}/${staged.id}/apply`, {
        method: 'POST',
        headers: headers('application/json'),
        body: '{nope',
      }),
      { params: Promise.resolve({ id: staged.id }) },
    );
    expect(garbage.status).toBe(400);
    expect(snapshot().restore).toEqual([`${staged.id}.json`]);
    expect(snapshot().rows.recipes).toBe(0);
  });

  it('401 and CSRF 403 on apply and delete', async () => {
    const staged = await (await stage(ownBackup())).json();
    state.current = null;
    expect((await applyReq(staged.id)).status).toBe(401);
    expect((await del(staged.id)).status).toBe(401);
    state.current = me;
    expect(
      (
        await applyReq(staged.id, { strategy: 'skip' }, {
          'content-type': 'application/json',
        } as never)
      ).status,
    ).toBe(403);
    expect((await del(staged.id, {})).status).toBe(403);
    expect((await del(staged.id, { origin: 'https://evil.test' })).status).toBe(403);
    expect(snapshot().restore).toEqual([`${staged.id}.json`]);
    expect(snapshot().rows.recipes).toBe(0);
  });

  it("another user's id is 404 for apply and delete, and the stage survives", async () => {
    const staged = await (await stage(ownBackup())).json();
    state.current = other;
    expect((await applyReq(staged.id)).status).toBe(404);
    expect((await del(staged.id)).status).toBe(404);
    expect((await applyReq(ulid())).status).toBe(404);
    expect((await applyReq('../../etc')).status).toBe(404);
    expect(snapshot().restore).toEqual([`${staged.id}.json`]);
    state.current = me;
    expect((await applyReq(staged.id)).status).toBe(200);
  });

  it('an expired stage is 404 and its file is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const staged = await (await stage(ownBackup())).json();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1000);
    const res = await applyReq(staged.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found', message: expect.any(String) });
    expect(snapshot().restore).toEqual([]);
    expect(snapshot().rows.recipes).toBe(0);
  });

  it("any restore call prunes other users' expired stages and old orphan files", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    state.current = other;
    const old = await (await stage(ownBackup())).json();
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    state.current = me;
    expect((await stage(ownBackup())).status).toBe(201);
    expect(snapshot().restore).toHaveLength(1);
    expect(snapshot().restore[0]).not.toContain(old.id);
  });

  it('DELETE discards: 204 without a body, file gone, then 404', async () => {
    const staged = await (await stage(ownBackup())).json();
    const res = await del(staged.id);
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('');
    expect(snapshot().restore).toEqual([]);
    expect((await del(staged.id)).status).toBe(404);
  });

  it('409 when an apply runs anywhere in the process; nothing is consumed', async () => {
    const mine = await (await stage(ownBackup())).json();
    const busy = registerStage({
      id: ulid(),
      ownerId: other.id,
      kind: 'json',
      path: join(root, 'x.json'),
      createdAt: Date.now(),
    });
    const lease = beginApply(busy);
    const res = await applyReq(mine.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'restore_in_progress',
      message: expect.any(String),
    });
    expect(snapshot().restore).toEqual([`${mine.id}.json`]);
    expect(snapshot().rows.recipes).toBe(0);
    if (lease !== 'busy') lease.end();
    expect((await applyReq(mine.id)).status).toBe(200);
  });

  it('two simultaneous applies: exactly one runs, the other is 409', async () => {
    const mine = await (await stage(ownBackup())).json();
    // A second staged file of the same user (a stale one kept by hand), applied at the same time.
    const second = ulid();
    writeFileSync(join(env.RESTORE_DIR, `${second}.json`), ownBackup(['Gamma']));
    registerStage({
      id: second,
      ownerId: me.id,
      kind: 'json',
      path: join(env.RESTORE_DIR, `${second}.json`),
      createdAt: Date.now(),
    });
    const theirs = { id: second };
    const [a, b] = await Promise.all([applyReq(mine.id), applyReq(theirs.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('a stale or tampered staged file fails closed: 422, file removed, nothing imported', async () => {
    const staged = await (await stage(ownBackup())).json();
    writeFileSync(join(env.RESTORE_DIR, `${staged.id}.json`), '{"version":9}');
    const res = await applyReq(staged.id);
    expect(res.status).toBe(422);
    expect(snapshot().restore).toEqual([]);
    expect(snapshot().rows.recipes).toBe(0);
  });

  it('a member demoted view: a scope all stage applied by a non-admin is 403 and removed', async () => {
    state.current = admin;
    const staged = await (await stage(allBackup())).json();
    state.current = { ...admin, role: 'member' };
    const res = await applyReq(staged.id);
    expect(res.status).toBe(403);
    expect(snapshot().restore).toEqual([]);
    expect(snapshot().rows.recipes).toBe(0);
  });

  it('a partial failure removes the staged file and reports failed_at', async () => {
    const d = JSON.parse(ownBackup());
    d.recipes[1].view_mode = 'grid';
    d.recipes[1].sections[0].steps = [
      {
        position: 0,
        kind: 'column',
        label: 'x',
        detail: '',
        row_start: 0,
        row_end: 999,
        temp_c: null,
        temp_f: null,
        minutes_min: null,
        minutes_max: null,
      },
    ];
    const staged = await (await stage(JSON.stringify(d))).json();
    const res = await applyReq(staged.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, failed_at: 1 });
    expect(snapshot().restore).toEqual([]);
  });

  it('photos from a zip land in UPLOADS_DIR under fresh names; a bad one is counted', async () => {
    const d = JSON.parse(ownBackup(['Alpha']));
    const good = `photos/${ulid()}.webp`;
    const bad = `photos/${ulid()}.webp`;
    d.recipes[0].photos = [
      { position: 0, is_cover: true, width: 64, height: 48, file: good, thumb: null },
      { position: 1, is_cover: false, width: 64, height: 48, file: bad, thumb: null },
    ];
    const zip = rawZip([
      { name: BACKUP_ENTRY, data: Buffer.from(JSON.stringify(d)) },
      { name: good, data: await webp() },
      { name: bad, data: Buffer.from('<svg onload=alert(1)>') },
    ]);
    const staged = await (await stage(zip, 'application/zip')).json();
    expect(staged.preview.photos).toBe(2);
    const res = await applyReq(staged.id);
    expect(await res.json()).toMatchObject({ imported: 1, photos_restored: 1, photos_failed: 1 });
    const files = ls(env.UPLOADS_DIR);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.includes(good.slice(7, 20)))).toBe(false);
    expect(snapshot().restore).toEqual([]);
  });
});

describe('round trip through the routes', () => {
  /** Instance A: ann owns the samples and the maximal recipe, with real photo files and notes. */
  async function instanceA() {
    const a = memDb();
    const uploadsA = join(root, 'uploads-a');
    const admin = mkUser(a, 'admin@x.test', 'admin');
    const ann = mkUser(a, 'ann@x.test');
    const bob = mkUser(a, 'bob@x.test');
    const ids = [SAMPLE_INPUTS[0], SAMPLE_INPUTS[1], maximalRecipe()].map((input, i) =>
      saveInput(a, ann.id, { ...input, visibility: i === 1 ? 'users' : 'private' }),
    );
    const bytes = await webp(80, 60);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(uploadsA, { recursive: true });
    ids.forEach((id, ri) => {
      for (let i = 0; i < 2; i++) {
        const file = `${ulid()}.webp`;
        const thumb = `${ulid()}.webp`;
        writeFileSync(join(uploadsA, file), bytes);
        writeFileSync(join(uploadsA, thumb), bytes);
        a.insert(photo)
          .values({
            recipeId: id,
            filePath: file,
            thumbPath: thumb,
            width: 80,
            height: 60,
            position: i,
            isCover: i === ri % 2,
          })
          .run();
      }
      addNote(a, id, ann.id, `ann note ${ri}`, ri % 2 === 0);
      addNote(a, id, ann.id, `ann second ${ri}`, false);
      addRating(a, id, ann.id, 3 + (ri % 3));
    });
    addNote(a, ids[0]!, bob.id, 'bob shared', true);
    addRating(a, ids[0]!, bob.id, 1);
    return { a, uploadsA, admin, ann, bob, ids };
  }

  async function exportZip(a: Db, uploadsA: string, who: U, all: boolean): Promise<Buffer> {
    const saveDb = state.db;
    const saveUp = env.UPLOADS_DIR;
    state.db = a;
    state.current = who;
    env.UPLOADS_DIR = uploadsA;
    try {
      const res = await exportGet(
        new Request(`http://localhost:3100/api/export?photos=1${all ? '&all=1' : ''}`),
      );
      expect(res.status).toBe(200);
      return await collect(res.body!);
    } finally {
      state.db = saveDb;
      env.UPLOADS_DIR = saveUp;
    }
  }

  it('own scope: export from A, stage and apply into an empty B, documents equal', async () => {
    const w = await instanceA();
    const zip = await exportZip(w.a, w.uploadsA, w.ann as U, false);
    const docA = viaJson(buildBackup(w.a, w.ann, { all: false }));

    const b = memDb();
    state.db = b;
    const ann2 = mkUser(b, 'ann2@x.test');
    state.current = ann2;
    const staged = await (await stage(zip, 'application/zip')).json();
    expect(staged.preview).toMatchObject({
      recipes: 3,
      photos: 6,
      notes: 6,
      notes_skipped: 1,
      ratings: 3,
    });
    const res = await (await applyReq(staged.id)).json();
    expect(res).toMatchObject({
      imported: 3,
      photos_restored: 6,
      photos_failed: 0,
      failed_at: null,
    });

    const docB = viaJson(buildBackup(b, ann2, { all: false }));
    const expected = normalizeDoc(docA);
    for (const r of expected.recipes) {
      r.notes = r.notes
        .filter((n) => n.mine === true)
        .map((n) => ({ ...n, author_display_name: ann2.displayName }));
    }
    expect(normalizeDoc(docB)).toEqual(expected);
    // Files: 12 fresh files in B's uploads, none shared with A's names.
    const filesB = ls(env.UPLOADS_DIR);
    expect(filesB).toHaveLength(12);
    expect(filesB.filter((f) => ls(w.uploadsA).includes(f))).toEqual([]);
    expect(ls(env.RESTORE_DIR)).toEqual([]);
    b.$client.close();
    w.a.$client.close();
    state.db = db;
  });

  it("all scope: an admin restores every user's recipes, notes and ratings into an empty B", async () => {
    const w = await instanceA();
    const zip = await exportZip(w.a, w.uploadsA, w.admin as U, true);
    const docA = viaJson(buildBackup(w.a, w.admin, { all: true }));

    const b = memDb();
    state.db = b;
    const admin2 = mkUser(b, 'admin@x.test', 'admin');
    mkUser(b, 'ann@x.test');
    mkUser(b, 'bob@x.test');
    state.current = admin2;
    const staged = await (await stage(zip, 'application/zip')).json();
    expect(staged.preview).toMatchObject({
      scope: 'all',
      recipes: 3,
      unknown_users: [],
      notes_skipped: 0,
    });
    const res = await (await applyReq(staged.id)).json();
    expect(res).toMatchObject({ imported: 3, photos_restored: 6, failed_at: null });
    const docB = viaJson(buildBackup(b, admin2, { all: true }));
    expect(normalizeDoc(docB)).toEqual(normalizeDoc(docA));
    expect(ls(env.RESTORE_DIR)).toEqual([]);
    b.$client.close();
    w.a.$client.close();
    state.db = db;
  });

  it('the staged JSON of the same export (no photos) restores everything but photos', async () => {
    const w = await instanceA();
    const text = JSON.stringify(buildBackup(w.a, w.ann, { all: false }));
    const b = memDb();
    state.db = b;
    const ann2 = mkUser(b, 'ann2@x.test');
    state.current = ann2;
    const staged = await (await stage(text)).json();
    expect(staged.preview.photos).toBe(0);
    const res = await (await applyReq(staged.id)).json();
    expect(res).toMatchObject({ imported: 3, photos_restored: 0, photos_failed: 0 });
    expect(ls(env.UPLOADS_DIR)).toEqual([]);
    b.$client.close();
    w.a.$client.close();
    state.db = db;
  });

  it('keeps the file reads honest: the export contains the photo entries it should', async () => {
    const w = await instanceA();
    const zip = await exportZip(w.a, w.uploadsA, w.ann as U, false);
    expect(zip.length).toBeGreaterThan(readFileSync(join(w.uploadsA, ls(w.uploadsA)[0]!)).length);
    w.a.$client.close();
  });
});
