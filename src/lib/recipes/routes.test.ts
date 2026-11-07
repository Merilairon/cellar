import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { user } from '@/lib/db/schema';
import type { User } from '@/lib/db/users';
import { SAMPLE_SKILLET_COOKIES } from './samples';
import { GRID_BODY_MAX } from './http';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => ({ BASE_URL: 'http://localhost:3100' }) }));

import { GET as listGet, POST as createPost } from '@/app/api/recipes/route';
import { DELETE, GET, PUT } from '@/app/api/recipes/[id]/route';
import { POST as copyPost } from '@/app/api/recipes/[id]/copy/route';
import {
  PUT as gridPut,
  GET as gridGet,
  DELETE as gridDelete,
} from '@/app/api/recipes/[id]/grid/route';
import { GET as tagsGet } from '@/app/api/tags/route';
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

  it('415 without a JSON content type (after CSRF and auth), on every body route', async () => {
    const noType = { 'sec-fetch-site': 'same-origin' };
    const text = { ...noType, 'content-type': 'text/plain' };
    expect((await createPost(req('POST', SAMPLE_SKILLET_COOKIES, noType))).status).toBe(415);
    expect((await createPost(req('POST', SAMPLE_SKILLET_COOKIES, text))).status).toBe(415);
    const { json } = await create();
    expect((await PUT(req('PUT', SAMPLE_SKILLET_COOKIES, text), ctx(json.id))).status).toBe(415);
    expect((await visPut(req('PUT', { visibility: 'users' }, text), ctx(json.id))).status).toBe(
      415,
    );
    const charset = { ...noType, 'content-type': 'application/json; charset=utf-8' };
    expect((await createPost(req('POST', SAMPLE_SKILLET_COOKIES, charset))).status).toBe(201);
    expect((await createPost(req('POST', SAMPLE_SKILLET_COOKIES, {}))).status).toBe(403);
    state.current = null;
    expect((await createPost(req('POST', SAMPLE_SKILLET_COOKIES, noType))).status).toBe(401);
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

  it('I1: GET /api/recipes/:id is private, no-store on 200, 404 and 401', async () => {
    const { json } = await create();
    const ok = await GET(req('GET', undefined, {}), ctx(json.id));
    expect([ok.status, ok.headers.get('cache-control')]).toEqual([200, 'private, no-store']);
    const missing = await GET(req('GET', undefined, {}), ctx('NOPE'));
    expect([missing.status, missing.headers.get('cache-control')]).toEqual([
      404,
      'private, no-store',
    ]);
    state.current = other;
    const hidden = await GET(req('GET', undefined, {}), ctx(json.id));
    expect([hidden.status, hidden.headers.get('cache-control')]).toEqual([
      404,
      'private, no-store',
    ]);
    state.current = null;
    const anon = await GET(req('GET', undefined, {}), ctx(json.id));
    expect([anon.status, anon.headers.get('cache-control')]).toEqual([401, 'private, no-store']);
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

describe('PUT /api/recipes/:id/grid', () => {
  const stripIds = (o: Loose): Loose =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'id' && k !== 'position'));
  const gridBody = (r: Loose, edit?: (sections: Loose[]) => void) => {
    const sections = (r.sections as Loose[]).map((s) => ({
      title: s.title,
      ingredients: (s.ingredients as Loose[]).map((x) => stripIds(x)),
      steps: (s.steps as Loose[]).map((x) => stripIds(x)),
    }));
    edit?.(sections);
    return { base_updated_at: r.updated_at, sections };
  };
  const created = async (over: Loose = {}) =>
    (await create({ ...SAMPLE_SKILLET_COOKIES, ...over })).json as unknown as Loose;
  const put = (id: string, body: unknown, headers: Record<string, string> = same, raw?: string) =>
    gridPut(req('PUT', body, headers, raw), ctx(id));
  const NO_STORE = 'private, no-store';

  it('owner 200 returns the full recipe with a new updated_at; no-store', async () => {
    const r = await created();
    const res = await put(
      r.id,
      gridBody(r, (s) => (s[0].ingredients[0].name = 'ghee')),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    const out = (await res.json()) as Loose;
    expect(out.sections[0].ingredients[0].name).toBe('ghee');
    expect(out.updated_at > r.updated_at).toBe(true);
    expect(out.title).toBe(r.title);
  });

  it('authorization matrix: admin 200, member on users recipe 403, member on private 404, unknown 404, anonymous 401', async () => {
    const shared = await created({ visibility: 'users' });
    const priv = await created({ visibility: 'private' });
    state.current = other;
    expect((await put(shared.id, gridBody(shared))).status).toBe(403);
    expect((await put(priv.id, gridBody(priv))).status).toBe(404);
    expect((await put('NOPE', gridBody(priv))).status).toBe(404);
    const admin = mk('adm@x.test', 'admin');
    state.current = admin;
    const res = await put(priv.id, gridBody(priv));
    expect(res.status).toBe(200);
    state.current = null;
    expect((await put(priv.id, gridBody(priv))).status).toBe(401);
    state.current = owner;
    const stored = await (await GET(req('GET', undefined, {}), ctx(priv.id))).json();
    expect((stored as Loose).sections[0].ingredients).toHaveLength(9);
  });

  it('403 without CSRF proof before any work, 415 wrong type, 413 oversize, 400 bad JSON', async () => {
    const r = await created();
    const before = db.$client.prepare('select updated_at from recipe').get();
    expect((await put(r.id, gridBody(r), { 'content-type': 'application/json' })).status).toBe(403);
    expect((await put(r.id, gridBody(r), { ...same, 'sec-fetch-site': 'cross-site' })).status).toBe(
      403,
    );
    expect(
      (
        await put(r.id, gridBody(r), {
          'sec-fetch-site': 'same-origin',
          'content-type': 'text/plain',
        })
      ).status,
    ).toBe(415);
    expect((await put(r.id, undefined, same, '{nope')).status).toBe(400);
    const big = await put(r.id, undefined, same, JSON.stringify({ pad: 'x'.repeat(1_100_000) }));
    expect(big.status).toBe(413);
    expect(db.$client.prepare('select updated_at from recipe').get()).toEqual(before);
  });

  it('409 on a stale base with the current updated_at; sequential saves with one base: 200 then 409', async () => {
    const r = await created();
    const body = gridBody(r);
    const first = (await (await put(r.id, body)).json()) as Loose;
    const second = await put(r.id, body);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'conflict', updated_at: first.updated_at });
    expect(second.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('a recipe-form PUT between load and save causes 409', async () => {
    const r = await created();
    const body = gridBody(r);
    expect(
      (await PUT(req('PUT', { ...SAMPLE_SKILLET_COOKIES, title: 'Renamed' }), ctx(r.id))).status,
    ).toBe(200);
    expect((await put(r.id, body)).status).toBe(409);
  });

  it('422 with validator paths; an uncovered row is 200; unknown keys 422', async () => {
    const r = await created();
    const bad = await put(
      r.id,
      gridBody(r, (s) => (s[0].steps[3].row_end = 30)),
    );
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({
      errors: [{ path: 'sections.0.steps.3.row_end', code: 'row_out_of_range' }],
    });
    expect((await put(r.id, { ...gridBody(r), tags: ['x'] })).status).toBe(422);
    expect((await put(r.id, { sections: gridBody(r).sections })).status).toBe(422);
    const uncovered = await put(
      r.id,
      gridBody(r, (s) => (s[0].steps = s[0].steps.slice(0, 3))),
    );
    expect(uncovered.status).toBe(200);
  });

  it('every response carries Cache-Control: private, no-store (table)', async () => {
    const r = await created({ visibility: 'users' });
    const rows: Array<[number, () => Promise<Response>]> = [
      [403, () => put(r.id, gridBody(r), { 'content-type': 'application/json' })],
      [415, () => put(r.id, gridBody(r), { 'sec-fetch-site': 'same-origin' })],
      [400, () => put(r.id, undefined, same, '{nope')],
      [413, () => put(r.id, undefined, same, 'x'.repeat(1_100_000))],
      [422, () => put(r.id, { base_updated_at: r.updated_at, sections: [] })],
      [409, () => put(r.id, { ...gridBody(r), base_updated_at: '2000-01-01T00:00:00.000Z' })],
      [404, () => put('NOPE', gridBody(r))],
      [405, () => Promise.resolve(gridGet())],
      [405, () => Promise.resolve(gridDelete())],
      [200, () => put(r.id, gridBody(r))],
    ];
    for (const [status, call] of rows) {
      const res = await call();
      expect(res.status, String(status)).toBe(status);
      expect(res.headers.get('cache-control'), String(status)).toBe(NO_STORE);
    }
    state.current = other;
    const cur = (await (await GET(req('GET', undefined, {}), ctx(r.id))).json()) as Loose;
    expect((await put(r.id, gridBody(cur))).status).toBe(403);
    expect((await put(r.id, gridBody(cur))).headers.get('cache-control')).toBe(NO_STORE);
    state.current = null;
    const anon = await put(r.id, gridBody(cur));
    expect([anon.status, anon.headers.get('cache-control')]).toEqual([401, NO_STORE]);
  });

  it('error bodies carry codes and paths only (no stack, SQL or ids)', async () => {
    const r = await created();
    const res = await put(
      r.id,
      gridBody(r, (s) => (s[0].ingredients[0].name = '')),
    );
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      errors: [{ path: 'sections.0.ingredients.0.name', code: 'too_small' }],
    });
  });

  it('a payload at the schema ceiling (20 sections x 200 ingredients, about 475 KB) is a 200 under the grid body cap; over 1 MB is 413', async () => {
    const r = await created();
    const ingredients = Array.from({ length: 200 }, (_, i) => ({
      name: `ingredient number ${i}`,
      note: 'finely chopped',
      display_primary: 'metric',
      metric_qty: 100,
      metric_unit: 'g',
    }));
    const body = {
      base_updated_at: r.updated_at,
      sections: Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, ingredients, steps: [] })),
    };
    expect(JSON.stringify(body).length).toBeGreaterThan(256 * 1024); // why the cap is not SAVE_BODY_MAX
    expect(JSON.stringify(body).length).toBeLessThan(GRID_BODY_MAX);
    expect((await put(r.id, body)).status).toBe(200);
  });

  it('C3: GET /api/recipes and /api/tags error responses are no-store too', async () => {
    const hdr = (r: Response) => r.headers.get('cache-control');
    const bad = await listGet(
      new Request('http://localhost:3100/api/recipes?bogus=1', { headers: same }),
    );
    expect([bad.status, hdr(bad)]).toEqual([400, 'private, no-store']);
    const q = await tagsGet(
      new Request(`http://localhost:3100/api/tags?q=${'x'.repeat(50)}`, { headers: same }),
    );
    expect([q.status, hdr(q)]).toEqual([400, 'private, no-store']);
    state.current = null;
    const a = await listGet(req('GET', undefined, {}));
    const b = await tagsGet(req('GET', undefined, {}));
    expect([a.status, hdr(a), b.status, hdr(b)]).toEqual([
      401,
      'private, no-store',
      401,
      'private, no-store',
    ]);
  });
});
