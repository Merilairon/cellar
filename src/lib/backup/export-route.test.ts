import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/connection';
import { photo } from '@/lib/db/schema';
import { backupV1Schema } from './schema';
import {
  addNote,
  addPhotos,
  memDb,
  mkUser,
  saveInput,
  SAMPLE_INPUTS,
  type U,
} from './test-fixtures';
import { collect, readZip } from './zip-test-util';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown }));
const env = vi.hoisted(() => ({
  BASE_URL: 'http://localhost:3100',
  UPLOADS_DIR: '',
  RATE_LIMIT_EXPORT_MAX: 10,
  RATE_LIMIT_EXPORT_WINDOW_SEC: 3600,
}));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => env }));

import { GET } from '@/app/api/export/route';

let db: Db;
let uploads: string;
let me: U;
let admin: U;
let other: U;
const registry = globalThis as unknown as {
  __rateLimiters?: Map<string, unknown>;
  __exportInFlight?: Map<string, number>;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  db = memDb();
  state.db = db;
  uploads = mkdtempSync(join(tmpdir(), 'export-route-'));
  env.UPLOADS_DIR = uploads;
  env.RATE_LIMIT_EXPORT_MAX = 10;
  registry.__rateLimiters?.delete('export:user');
  registry.__exportInFlight?.clear();
  me = mkUser(db, 'me@x.test');
  other = mkUser(db, 'other@x.test');
  admin = mkUser(db, 'admin@x.test', 'admin');
  state.current = me;
});
afterEach(() => {
  vi.useRealTimers();
  db.$client.close();
  rmSync(uploads, { recursive: true, force: true });
});

const get = (qs = '') => GET(new Request(`http://localhost:3100/api/export${qs}`));

/** A recipe of `owner` with n photos; every stored file is written to the uploads dir. */
function recipeWithPhotos(owner: U, n: number, title = 'R'): string {
  const id = saveInput(db, owner.id, { ...SAMPLE_INPUTS[0], title });
  addPhotos(db, id, n);
  for (const p of db.select().from(photo).where(eq(photo.recipeId, id)).all()) {
    for (const f of [p.filePath, p.thumbPath]) {
      if (f) writeFileSync(join(uploads, f), Buffer.from(`bytes of ${f}`));
    }
  }
  return id;
}

describe('GET /api/export (JSON)', () => {
  it('401 without a session', async () => {
    state.current = null;
    expect((await get()).status).toBe(401);
  });

  it('member: own recipes only, download headers, no-store', async () => {
    saveInput(db, me.id, { ...SAMPLE_INPUTS[0], title: 'Mine' });
    saveInput(db, other.id, { ...SAMPLE_INPUTS[0], title: 'Theirs', visibility: 'users' });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="cellar-backup-2026-11-17.json"',
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const doc = backupV1Schema.parse(await res.json());
    expect(doc.scope).toBe('own');
    expect(doc.recipes.map((r) => r.title)).toEqual(['Mine']);
  });

  it('?all=1 is 403 with a message for a member and the whole instance for an admin', async () => {
    saveInput(db, me.id, { ...SAMPLE_INPUTS[0], title: 'Mine' });
    saveInput(db, other.id, { ...SAMPLE_INPUTS[0], title: 'Theirs' });
    const denied = await get('?all=1');
    expect(denied.status).toBe(403);
    expect(denied.headers.get('cache-control')).toBe('private, no-store');
    expect(await denied.json()).toMatchObject({ error: 'forbidden', message: expect.any(String) });

    state.current = admin;
    const res = await get('?all=1');
    expect(res.status).toBe(200);
    const doc = backupV1Schema.parse(await res.json());
    expect(doc.scope).toBe('all');
    expect(doc.recipes.map((r) => r.title).sort()).toEqual(['Mine', 'Theirs']);
  });

  it('unknown, repeated and malformed params are 400 invalid_query', async () => {
    for (const qs of [
      '?x=1',
      '?all=1&all=1',
      '?photos=1&photos=1',
      '?photos=0',
      '?all=true',
      '?photos=',
    ]) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'invalid_query',
        message: expect.any(String),
      });
    }
  });

  it('contains no id, hash or token', async () => {
    saveInput(db, me.id, { ...SAMPLE_INPUTS[0] });
    const text = await (await get()).text();
    expect(text).not.toContain(me.id);
    expect(text).not.toMatch(/password|share_token|\$argon2/);
  });

  it('the 11th export in the window is 429 with Retry-After and a message', async () => {
    for (let i = 0; i < 10; i++) expect((await get()).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ error: 'rate_limited', message: expect.any(String) });
    state.current = other; // per user
    expect((await get()).status).toBe(200);
  });
});

describe('GET /api/export?photos=1', () => {
  it('a zip whose first entry equals the JSON export and whose files are exactly the manifest', async () => {
    recipeWithPhotos(me, 3);
    recipeWithPhotos(other, 2, 'Not mine');
    const json = await (await get()).text();
    const res = await get('?photos=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="cellar-backup-2026-11-17.zip"',
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const entries = readZip(await collect(res.body!));
    expect(entries[0].name).toBe('backup.json');
    expect(entries[0].data.toString('utf8')).toBe(json);
    const doc = backupV1Schema.parse(JSON.parse(json));
    const expected = doc.recipes.flatMap((r) => r.photos.flatMap((p) => [p.file, p.thumb!]));
    expect(expected).toHaveLength(6);
    expect(entries.slice(1).map((e) => e.name)).toEqual(expected);
    const first = entries[1];
    expect(first.data.toString()).toBe(`bytes of ${first.name.slice('photos/'.length)}`);
  });

  it('omits a deleted photo and a deleted thumb from the manifest and counts them', async () => {
    const id = recipeWithPhotos(me, 3);
    const rows = db.select().from(photo).where(eq(photo.recipeId, id)).all();
    const byPos = [...rows].sort((a, b) => a.position - b.position);
    rmSync(join(uploads, byPos[0].filePath)); // the cover's full file
    rmSync(join(uploads, byPos[1].thumbPath!)); // a thumb only
    const res = await get('?photos=1');
    const entries = readZip(await collect(res.body!));
    const doc = backupV1Schema.parse(JSON.parse(entries[0].data.toString('utf8')));
    expect(doc.photos_missing).toBe(2);
    const photos = doc.recipes[0].photos;
    expect(photos).toHaveLength(2);
    expect(photos.map((p) => p.position)).toEqual([0, 1]);
    expect(photos[0].thumb).toBeNull();
    expect(photos.filter((p) => p.is_cover)).toHaveLength(1);
    const names = entries.slice(1).map((e) => e.name);
    expect(names).toEqual(photos.flatMap((p) => [p.file, ...(p.thumb ? [p.thumb] : [])]));
    expect(names).not.toContain(`photos/${byPos[0].filePath}`);
  });

  it('a user with no photos still gets a valid zip holding only backup.json', async () => {
    const res = await get('?photos=1');
    const entries = readZip(await collect(res.body!));
    expect(entries.map((e) => e.name)).toEqual(['backup.json']);
    expect(JSON.parse(entries[0].data.toString()).recipes).toEqual([]);
  });

  it('admin ?all=1&photos=1 is scope all; a member gets 403', async () => {
    recipeWithPhotos(other, 1);
    expect((await get('?all=1&photos=1')).status).toBe(403);
    state.current = admin;
    const entries = readZip(await collect((await get('?all=1&photos=1')).body!));
    expect(JSON.parse(entries[0].data.toString()).scope).toBe('all');
    expect(entries).toHaveLength(3);
  });

  it('a second concurrent export is 409 until the first stream ends', async () => {
    recipeWithPhotos(me, 1);
    const first = await get('?photos=1');
    const second = await get();
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: 'export_in_progress',
      message: expect.any(String),
    });
    state.current = other; // another user is not blocked
    expect((await get()).status).toBe(200);
    state.current = me;
    await collect(first.body!);
    expect((await get()).status).toBe(200);
  });

  it('cancelling the stream (aborted client) releases the slot', async () => {
    recipeWithPhotos(me, 2);
    const first = await get('?photos=1');
    const reader = first.body!.getReader();
    await reader.read();
    expect((await get()).status).toBe(409);
    await reader.cancel();
    expect((await get()).status).toBe(200);
  });

  it('a 429 releases the in-flight slot', async () => {
    env.RATE_LIMIT_EXPORT_MAX = 1;
    registry.__rateLimiters?.delete('export:user');
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
    expect((await get()).status).toBe(429); // would be 409 if the 429 leaked the slot
  });
});

describe('real readers accept the route output', () => {
  const run = (cmd: string, args: string[]) => spawnSync(cmd, args);
  const available = (cmd: string, args: string[]) => !run(cmd, args).error;

  const zipFile = async () => {
    recipeWithPhotos(me, 4);
    const dir = mkdtempSync(join(tmpdir(), 'export-zip-'));
    const p = join(dir, 'x.zip');
    writeFileSync(p, await collect((await get('?photos=1')).body!));
    return { p, dir };
  };

  it('python3 -I zipfile', async (ctx) => {
    if (!available('python3', ['-I', '-c', 'pass'])) return ctx.skip('python3 not available');
    const { p, dir } = await zipFile();
    const r = run('python3', [
      '-I',
      '-c',
      'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nassert z.namelist()[0] == "backup.json"\nprint(len(z.namelist()))',
      p,
    ]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.stderr.toString()).toBe('');
    expect(r.stdout.toString().trim()).toBe('9');
  });

  it('unzip -t', async (ctx) => {
    if (!available('unzip', ['-v'])) return ctx.skip('unzip not available');
    const { p, dir } = await zipFile();
    const r = run('unzip', ['-t', p]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(0);
    expect(r.stdout.toString()).toContain('No errors detected');
  });
});

describe('redaction', () => {
  it('a member zip carries no other user private note', async () => {
    const id = saveInput(db, me.id, { ...SAMPLE_INPUTS[0] });
    addNote(db, id, other.id, 'secret-other-note', false);
    const entries = readZip(await collect((await get('?photos=1')).body!));
    expect(entries[0].data.toString()).not.toContain('secret-other-note');
  });
});
