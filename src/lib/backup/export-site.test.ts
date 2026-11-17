import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/connection';
import { memDb, mkUser } from './test-fixtures';

// v1.0 security review L3: a cross-site navigation must not trigger (and spend the quota of)
// an export. Absent, same-origin, same-site and none stay allowed so curl and bookmarks work.

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
const registry = globalThis as unknown as {
  __rateLimiters?: Map<string, unknown>;
  __exportInFlight?: Map<string, number>;
};
beforeEach(() => {
  db = memDb();
  state.db = db;
  uploads = mkdtempSync(join(tmpdir(), 'export-site-'));
  env.UPLOADS_DIR = uploads;
  registry.__rateLimiters?.delete('export:user');
  registry.__exportInFlight?.clear();
  state.current = mkUser(db, 'me@x.test');
});
afterEach(() => {
  db.$client.close();
  rmSync(uploads, { recursive: true, force: true });
});

const get = (site?: string) =>
  GET(
    new Request('http://localhost:3100/api/export', {
      headers: site === undefined ? {} : { 'sec-fetch-site': site },
    }),
  );

describe('GET /api/export and Sec-Fetch-Site', () => {
  it('refuses a cross-site request with 403 and spends no quota', async () => {
    const res = await get('cross-site');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-disposition')).toBeNull();
    // Ten more allowed afterwards: the refused request did not hit the limiter.
    for (let i = 0; i < 10; i++) expect((await get('same-origin')).status).toBe(200);
  });

  it.each([undefined, 'same-origin', 'same-site', 'none'])(
    'allows Sec-Fetch-Site %s',
    async (s) => {
      expect((await get(s)).status).toBe(200);
    },
  );
});
