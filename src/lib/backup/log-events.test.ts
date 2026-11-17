import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/connection';
import { buildBackup } from './export';
import { resetStagingForTests } from './staging';
import { memDb, mkUser, saveInput, SAMPLE_INPUTS, type U } from './test-fixtures';
import { collect } from './zip-test-util';

// G18: the export and restore events. Content, file names and e-mails never reach the log.
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  current: null as unknown,
  logs: [] as Array<[string, string, Record<string, unknown>]>,
}));
const env = vi.hoisted(() => ({
  BASE_URL: 'http://localhost:3100',
  UPLOADS_DIR: '',
  RESTORE_DIR: '',
  RESTORE_BODY_MAX: 268_435_456,
  RATE_LIMIT_EXPORT_MAX: 100,
  RATE_LIMIT_EXPORT_WINDOW_SEC: 3600,
  RATE_LIMIT_RESTORE_MAX: 100,
  RATE_LIMIT_RESTORE_WINDOW_SEC: 3600,
}));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => env }));
vi.mock('@/lib/log', async (orig) => ({
  ...(await orig<typeof import('@/lib/log')>()),
  log: (level: string, event: string, fields: Record<string, unknown> = {}) =>
    state.logs.push([level, event, fields]),
}));

import { GET as exportGet } from '@/app/api/export/route';
import { POST as stagePost } from '@/app/api/import/backup/route';
import { POST as applyPost } from '@/app/api/import/backup/[id]/apply/route';

const ORIGIN = 'http://localhost:3100';
let db: Db;
let root: string;
let me: U;
let admin: U;
const registry = globalThis as unknown as { __rateLimiters?: Map<string, unknown> };

beforeEach(() => {
  resetStagingForTests();
  registry.__rateLimiters?.clear();
  root = mkdtempSync(join(tmpdir(), 'log-events-'));
  env.UPLOADS_DIR = join(root, 'uploads');
  env.RESTORE_DIR = join(root, 'restore');
  db = memDb();
  state.db = db;
  state.logs = [];
  me = mkUser(db, 'secret-me@x.test');
  admin = mkUser(db, 'secret-admin@x.test', 'admin');
  state.current = me;
  saveInput(db, me.id, { ...SAMPLE_INPUTS[0], title: 'Private Title Alpha' });
});
afterEach(() => {
  db.$client.close();
  rmSync(root, { recursive: true, force: true });
});

const events = () => state.logs.map(([, e]) => e);
const noLeak = () => {
  const text = JSON.stringify(state.logs);
  expect(text).not.toMatch(/secret-me|secret-admin|Private Title|@x\.test/);
};
const get = (qs = '') => exportGet(new Request(`http://localhost:3100/api/export${qs}`));
const url = 'http://localhost:3100/api/import/backup';
const stage = (body: string) =>
  stagePost(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body,
    }),
  );
const apply = (id: string) =>
  applyPost(
    new Request(`${url}/${id}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ strategy: 'rename' }),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('export events', () => {
  it('JSON member export: started then finished with user, scope, photos, count and bytes', async () => {
    const res = await get();
    const text = await res.text();
    expect(state.logs).toEqual([
      ['info', 'export.started', { user_id: me.id, scope: 'own', photos: false }],
      [
        'info',
        'export.finished',
        { user_id: me.id, scope: 'own', photos: false, recipes: 1, bytes: Buffer.byteLength(text) },
      ],
    ]);
    noLeak();
  });

  it('admin ?all=1 is the audit event: export.started with scope all', async () => {
    state.current = admin;
    await get('?all=1');
    expect(state.logs[0]).toEqual([
      'info',
      'export.started',
      { user_id: admin.id, scope: 'all', photos: false },
    ]);
  });

  it('a refused member ?all=1 is not an export: nothing is logged', async () => {
    expect((await get('?all=1')).status).toBe(403);
    expect(state.logs).toEqual([]);
  });

  it('zip export: finished is logged when the stream ends, with the byte count', async () => {
    const res = await get('?photos=1');
    expect(events()).toEqual(['export.started']);
    const bytes = (await collect(res.body!)).byteLength;
    expect(state.logs[1]).toEqual([
      'info',
      'export.finished',
      { user_id: me.id, scope: 'own', photos: true, recipes: 1, bytes },
    ]);
    noLeak();
  });

  it('a cancelled zip stream logs export.aborted at warn, not finished', async () => {
    const res = await get('?photos=1');
    await res.body!.cancel();
    // A pull racing the cancel may add `export.stream_failed`; it is not under test here.
    const seen = state.logs.filter(([, e]) => e !== 'export.stream_failed');
    expect(seen.map(([l, e]) => `${l} ${e}`)).toEqual([
      'info export.started',
      'warn export.aborted',
    ]);
  });
});

describe('restore events', () => {
  const backup = () => {
    const src = memDb();
    const u = mkUser(src, 'src-secret@x.test');
    saveInput(src, u.id, { ...SAMPLE_INPUTS[1], title: 'Private Title Beta' });
    const doc = JSON.stringify(buildBackup(src, u, { all: false }));
    src.$client.close();
    return doc;
  };

  it('stage then apply: counts and codes only', async () => {
    const staged = (await (await stage(backup())).json()) as { id: string };
    expect(state.logs).toEqual([
      [
        'info',
        'restore.staged',
        { user_id: me.id, kind: 'json', scope: 'own', recipes: 1, photos: 0, conflicts: 0 },
      ],
    ]);
    state.logs = [];
    expect((await apply(staged.id)).status).toBe(200);
    expect(state.logs).toEqual([
      [
        'info',
        'restore.applied',
        {
          user_id: me.id,
          strategy: 'rename',
          imported: 1,
          skipped: 0,
          renamed: 0,
          photos_restored: 0,
          photos_failed: 0,
          failed_at: null,
        },
      ],
    ]);
    noLeak();
  });

  it('a rejected upload logs restore.failed with the status, not the content', async () => {
    const res = await stage('{"this is": "Private Title Gamma"');
    expect(res.status).toBe(422);
    expect(state.logs).toEqual([
      ['warn', 'restore.failed', { user_id: me.id, phase: 'stage', status: 422 }],
    ]);
    noLeak();
    expect(JSON.stringify(state.logs)).not.toContain('Gamma');
  });
});
