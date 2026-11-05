import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { user } from '@/lib/db/schema';
import type { User } from '@/lib/db/users';
import { SAMPLE_SKILLET_COOKIES } from './samples';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => ({ BASE_URL: 'http://localhost:3100' }) }));

import { GET as listGet, POST as createPost } from '@/app/api/recipes/route';
import { DELETE, GET, PUT } from '@/app/api/recipes/[id]/route';
import { POST as copyPost } from '@/app/api/recipes/[id]/copy/route';
import { PUT as visPut } from '@/app/api/recipes/[id]/visibility/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

let db: Db;
let owner: User;
let other: User;
const mk = (email: string, role: 'admin' | 'member' = 'member') =>
  db.insert(user).values({ email, displayName: email, passwordHash: 'h', role }).returning().get();

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  owner = mk('o@x.test');
  other = mk('x@x.test');
  state.current = owner;
});
afterEach(() => db.$client.close());

const same = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const req = (
  method: string,
  body?: unknown,
  headers: Record<string, string> = same,
  raw?: string,
) =>
  new Request('http://localhost:3100/api/recipes', {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const create = async (body: unknown = SAMPLE_SKILLET_COOKIES) => {
  const res = await createPost(req('POST', body));
  return {
    res,
    json: (await res.json()) as { id: string; errors?: { path: string; code: string }[] },
  };
};

describe('POST /api/recipes', () => {
  it('201 with the full recipe, private by default', async () => {
    const { res, json } = await create({ ...SAMPLE_SKILLET_COOKIES, visibility: undefined });
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ visibility: 'private', owner_id: owner.id, can_edit: true });
  });

  it('403 without CSRF proof, before any db work', async () => {
    const res = await createPost(
      req('POST', SAMPLE_SKILLET_COOKIES, { 'content-type': 'application/json' }),
    );
    expect(res.status).toBe(403);
    const cross = await createPost(
      req('POST', SAMPLE_SKILLET_COOKIES, { ...same, 'sec-fetch-site': 'cross-site' }),
    );
    expect(cross.status).toBe(403);
    expect(db.$client.prepare('select count(*) n from recipe').get()).toEqual({ n: 0 });
  });

  it('401 without a session, 400 on bad JSON, 422 on invalid spans', async () => {
    state.current = null;
    expect((await createPost(req('POST', SAMPLE_SKILLET_COOKIES))).status).toBe(401);
    state.current = owner;
    expect((await createPost(req('POST', undefined, same, '{nope'))).status).toBe(400);
    const bad = structuredClone(SAMPLE_SKILLET_COOKIES) as Loose;
    bad.sections[0].steps[3].row_end = 30;
    const { res, json } = await create(bad);
    expect(res.status).toBe(422);
    expect(json.errors).toEqual([{ path: 'sections.0.steps.3.row_end', code: 'row_out_of_range' }]);
    bad.view_mode = 'list';
    expect((await create(bad)).res.status).toBe(201);
  });
});

describe('GET/PUT/DELETE /api/recipes/:id', () => {
  it("GET list and one; 404 for another user's private recipe; 401 unauthenticated", async () => {
    const { json } = await create();
    const list = (await (await listGet(req('GET', undefined, {}))).json()) as {
      recipes: unknown[];
    };
    expect(list.recipes).toHaveLength(1);
    expect((await GET(req('GET', undefined, {}), ctx(json.id))).status).toBe(200);
    state.current = other;
    expect((await GET(req('GET', undefined, {}), ctx(json.id))).status).toBe(404);
    state.current = null;
    expect((await GET(req('GET', undefined, {}), ctx(json.id))).status).toBe(401);
    expect((await listGet(req('GET', undefined, {}))).status).toBe(401);
  });

  it('PUT: 200, 403 for non-owner of a shared recipe, 403 without CSRF, 422', async () => {
    const { json } = await create({ ...SAMPLE_SKILLET_COOKIES, visibility: 'users' });
    const put = await PUT(
      req('PUT', { ...SAMPLE_SKILLET_COOKIES, visibility: undefined, title: 'New' }),
      ctx(json.id),
    );
    expect(put.status).toBe(200);
    expect(((await put.json()) as { title: string }).title).toBe('New');
    expect((await PUT(req('PUT', { title: '', sections: [] }), ctx(json.id))).status).toBe(422);
    expect((await PUT(req('PUT', SAMPLE_SKILLET_COOKIES, {}), ctx(json.id))).status).toBe(403);
    state.current = other;
    expect((await PUT(req('PUT', SAMPLE_SKILLET_COOKIES), ctx(json.id))).status).toBe(403);
    expect((await DELETE(req('DELETE'), ctx(json.id))).status).toBe(403);
  });

  it('DELETE: 204, then 404', async () => {
    const { json } = await create();
    expect((await DELETE(req('DELETE'), ctx(json.id))).status).toBe(204);
    expect((await DELETE(req('DELETE'), ctx(json.id))).status).toBe(404);
    expect(db.$client.prepare('select count(*) n from step').get()).toEqual({ n: 0 });
  });
});

describe('copy and visibility routes', () => {
  it('copy: 201 {id} for a shared recipe, 404 for private, 403 without CSRF, 401', async () => {
    const shared = (await create({ ...SAMPLE_SKILLET_COOKIES, visibility: 'users' })).json;
    const priv = (await create()).json;
    state.current = other;
    const res = await copyPost(req('POST'), ctx(shared.id));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { id: string }).id).toMatch(/^[0-9A-Z]{26}$/);
    expect((await copyPost(req('POST'), ctx(priv.id))).status).toBe(404);
    expect((await copyPost(req('POST', undefined, {}), ctx(shared.id))).status).toBe(403);
    state.current = null;
    expect((await copyPost(req('POST'), ctx(shared.id))).status).toBe(401);
  });

  it('visibility: owner 200, other 403/404, bad value 422, bad JSON 400, no CSRF 403', async () => {
    const { json } = await create();
    expect((await visPut(req('PUT', { visibility: 'users' }), ctx(json.id))).status).toBe(200);
    expect((await visPut(req('PUT', { visibility: 'nope' }), ctx(json.id))).status).toBe(422);
    expect((await visPut(req('PUT', undefined, same, 'x'), ctx(json.id))).status).toBe(400);
    expect((await visPut(req('PUT', { visibility: 'users' }, {}), ctx(json.id))).status).toBe(403);
    state.current = other;
    expect((await visPut(req('PUT', { visibility: 'private' }), ctx(json.id))).status).toBe(403);
    state.current = owner;
    await visPut(req('PUT', { visibility: 'private' }), ctx(json.id));
    state.current = other;
    expect((await visPut(req('PUT', { visibility: 'users' }), ctx(json.id))).status).toBe(404);
  });
});
