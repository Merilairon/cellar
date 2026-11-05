import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { importJob, recipe, user } from '@/lib/db/schema';
import type { User } from '@/lib/db/users';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  current: null as unknown,
  env: {} as Record<string, unknown>,
  fetch: (() => undefined) as (...a: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => state.env }));
vi.mock('@/lib/import/safe-fetch', async (orig) => ({
  ...(await orig<typeof import('@/lib/import/safe-fetch')>()),
  safeFetch: (...args: unknown[]) => state.fetch(...args),
}));

import { POST } from '@/app/api/import/route';
import { GET } from '@/app/api/import/[id]/route';
import { POST as SAVE } from '@/app/api/import/[id]/save/route';

const enc = new TextEncoder();
const page = `<html><script type="application/ld+json">${JSON.stringify({
  '@type': 'Recipe',
  name: 'Pancakes',
  recipeIngredient: ['2 eggs'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Fry.' }],
})}</script></html>`;

let db: Db;
let dir: string;
let a: User;
let b: User;
const mk = (email: string) =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role: 'member' })
    .returning()
    .get();
const same = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const post = (body: unknown, headers: Record<string, string> = same, raw?: string) =>
  new Request('http://localhost:3100/api/import', {
    method: 'POST',
    headers,
    body: raw ?? JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  dir = mkdtempSync(join(tmpdir(), 'rt-'));
  state.env = {
    BASE_URL: 'http://localhost:3100',
    IMPORT_ALLOW_LOCAL_FETCH: false,
    KEEP_RAW_HTML: false,
    UPLOADS_DIR: join(dir, 'uploads'),
    RATE_LIMIT_IMPORT_MAX: 20,
    RATE_LIMIT_IMPORT_WINDOW_SEC: 3600,
  };
  state.fetch = vi.fn(async () => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: enc.encode(page),
    finalUrl: 'https://example.com/p',
  }));
  (globalThis as { __rateLimiters?: unknown }).__rateLimiters = undefined;
  a = mk('a@x.test');
  b = mk('b@x.test');
  state.current = a;
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/import', () => {
  it('200 with the G5 shape for a URL, and no raw_html anywhere', async () => {
    const res = await POST(post({ url: 'https://example.com/p' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/raw_html|ld\+json/);
    expect(JSON.parse(text)).toMatchObject({
      status: 'needs_review',
      method: 'static',
      warnings: expect.any(Array),
      error_code: null,
      duplicate: null,
    });
  });

  it('a failed fetch is 200 with status failed + error_code', async () => {
    const { ImportError } = await import('./errors');
    state.fetch = vi.fn(async () => {
      throw new ImportError('timeout');
    });
    const res = await POST(post({ url: 'https://example.com/p' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'failed',
      error_code: 'timeout',
      draft: null,
    });
    expect(db.select().from(recipe).all()).toHaveLength(0);
  });

  it('paste works', async () => {
    const res = await POST(post({ text: page }));
    expect(await res.json()).toMatchObject({ status: 'needs_review', method: 'paste' });
  });

  it('403 on cross-site (CSRF) before any db or network work', async () => {
    const res = await POST(
      post(
        { url: 'https://example.com/' },
        { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      ),
    );
    expect(res.status).toBe(403);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(db.select().from(importJob).all()).toHaveLength(0);
  });

  it('401 without a session', async () => {
    state.current = null;
    expect((await POST(post({ url: 'https://example.com/' }))).status).toBe(401);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('415 for a non-JSON content type, 400 for invalid JSON', async () => {
    expect(
      (await POST(post({}, { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' })))
        .status,
    ).toBe(415);
    expect((await POST(post(null, same, '{nope'))).status).toBe(400);
  });

  it('422 for neither/both of url and text, wrong types and unknown keys', async () => {
    for (const body of [
      {},
      { url: 'https://a.test/', text: 'x' },
      { url: 5 },
      { text: '' },
      { url: 'https://a.test/', allowLocal: true },
    ]) {
      expect((await POST(post(body))).status, JSON.stringify(body)).toBe(422);
    }
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('422 when text exceeds 500 KB', async () => {
    expect((await POST(post({ text: 'a'.repeat(500_001) }))).status).toBe(422);
  });

  it('allowLocal comes only from env, never from the request', async () => {
    await POST(
      post({ url: 'https://example.com/p', allowLocal: true, fetchOptions: { allowLocal: true } }),
    );
    expect(state.fetch).not.toHaveBeenCalled(); // strict schema refused it outright
    await POST(
      new Request('http://localhost:3100/api/import?allowLocal=true', {
        method: 'POST',
        headers: { ...same, 'x-allow-local': '1' },
        body: JSON.stringify({ url: 'https://example.com/p' }),
      }),
    );
    expect((state.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      allowLocal: false,
    });
    state.env.IMPORT_ALLOW_LOCAL_FETCH = true;
    await POST(post({ url: 'https://example.com/q' }));
    expect((state.fetch as ReturnType<typeof vi.fn>).mock.calls[1]![1]).toMatchObject({
      allowLocal: true,
    });
  });

  it('429 with Retry-After on the 21st request, counting failures, per user', async () => {
    state.fetch = vi.fn(async () => {
      throw new Error('boom');
    });
    for (let i = 0; i < 20; i++)
      expect((await POST(post({ url: 'https://example.com/p' }))).status).toBe(200);
    const res = await POST(post({ url: 'https://example.com/p' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    state.current = b; // another user is not limited
    expect((await POST(post({ url: 'https://example.com/p' }))).status).toBe(200);
  });
});

describe('GET /api/import/:id', () => {
  it('owner gets the job, others 404, anonymous 401', async () => {
    const { id } = (await (await POST(post({ url: 'https://example.com/p' }))).json()) as {
      id: string;
    };
    const get = (uid: string) => GET(new Request('http://localhost:3100/api/import/x'), ctx(uid));
    const ok = await get(id);
    expect(ok.status).toBe(200);
    expect(await ok.text()).not.toMatch(/raw_html/);
    state.current = b;
    expect((await get(id)).status).toBe(404);
    state.current = null;
    expect((await get(id)).status).toBe(401);
  });
});

describe('POST /api/import/:id/save', () => {
  const draft = {
    title: 'Pancakes',
    sections: [
      {
        title: null,
        ingredients: [{ name: 'eggs' }],
        steps: [{ kind: 'banner_top', label: 'Fry', detail: '' }],
      },
    ],
  };
  const saveReq = (body: unknown) =>
    new Request('http://localhost:3100/api/import/x/save', {
      method: 'POST',
      headers: same,
      body: JSON.stringify(body),
    });
  const start = async () =>
    ((await (await POST(post({ url: 'https://example.com/p' }))).json()) as { id: string }).id;

  it('201 with the recipe id, then 409 on a second save', async () => {
    const id = await start();
    const res = await SAVE(saveReq(draft), ctx(id));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: expect.any(String), warnings: [] });
    expect((await SAVE(saveReq(draft), ctx(id))).status).toBe(409);
    expect(db.select().from(recipe).all()).toHaveLength(1);
  });

  it("404 for another user's job, 403 for CSRF, 422 for a bad draft", async () => {
    const id = await start();
    state.current = b;
    expect((await SAVE(saveReq(draft), ctx(id))).status).toBe(404);
    state.current = a;
    const csrf = new Request('http://localhost:3100/x', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: '{}',
    });
    expect((await SAVE(csrf, ctx(id))).status).toBe(403);
    expect((await SAVE(saveReq({ title: '' }), ctx(id))).status).toBe(422);
    expect(db.select().from(recipe).all()).toHaveLength(0);
  });
});
