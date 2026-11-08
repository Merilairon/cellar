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
import { GET, PUT } from '@/app/api/recipes/[id]/route';
import { POST as copyPost } from '@/app/api/recipes/[id]/copy/route';
import { GET as tagsGet } from '@/app/api/tags/route';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: Db;
let owner: User;
let other: User;
const mk = (email: string) =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role: 'member' })
    .returning()
    .get();
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
const req = (method: string, body?: unknown, url = 'http://localhost:3100/api/recipes') =>
  new Request(url, {
    method,
    headers: same,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const create = async (body: Loose) => {
  const res = await createPost(req('POST', { ...SAMPLE_SKILLET_COOKIES, ...body }));
  return { res, json: (await res.json()) as Loose };
};
const tagsReq = (qs = '', headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) =>
  tagsGet(new Request(`http://localhost:3100/api/tags${qs}`, { headers }));

describe('tags on the recipe API', () => {
  it('normalizes and dedupes on create; GET returns them sorted; old recipes have []', async () => {
    const { res, json } = await create({ tags: ['Dessert', ' dessert ', 'chocolate'] });
    expect(res.status).toBe(201);
    expect(json.tags).toEqual(['chocolate', 'dessert']);
    const got = (await (await GET(req('GET'), ctx(json.id))).json()) as Loose;
    expect(got.tags).toEqual(['chocolate', 'dessert']);
    const plain = await create({});
    expect(plain.json.tags).toEqual([]);
  });

  it('PUT: omitted tags keep, [] clears, a new list replaces', async () => {
    const { json } = await create({ tags: ['a', 'b'] });
    const put = async (body: Loose) =>
      (await (
        await PUT(req('PUT', { ...SAMPLE_SKILLET_COOKIES, ...body }), ctx(json.id))
      ).json()) as Loose;
    expect((await put({})).tags).toEqual(['a', 'b']);
    expect((await put({ tags: ['b', 'c'] })).tags).toEqual(['b', 'c']);
    expect((await put({ tags: [] })).tags).toEqual([]);
  });

  it.each([
    ['empty', ['']],
    ['whitespace only', ['   ']],
    ['too long', ['x'.repeat(41)]],
    ['control character', ['a\u0000b']],
    ['non-string', [5]],
    ['more than 20', Array.from({ length: 21 }, (_, i) => `t${i}`)],
  ])('422 for invalid tags: %s', async (_n, tags) => {
    const { res, json } = await create({ tags });
    expect(res.status).toBe(422);
    expect(JSON.stringify(json.errors)).toContain('tags');
    expect(db.$client.prepare('select count(*) n from tag').get()).toEqual({ n: 0 });
  });

  it('422 when tags is not an array', async () => {
    expect((await create({ tags: 'dessert' })).res.status).toBe(422);
  });

  it('exactly 20 tags is accepted', async () => {
    const { res, json } = await create({ tags: Array.from({ length: 20 }, (_, i) => `t${i}`) });
    expect(res.status).toBe(201);
    expect(json.tags).toHaveLength(20);
  });

  it('copy carries tags', async () => {
    const { json } = await create({ tags: ['soup'], visibility: 'users' });
    state.current = other;
    const res = await copyPost(req('POST'), ctx(json.id));
    const copy = (await res.json()) as Loose;
    const got = (await (await GET(req('GET'), ctx(copy.id))).json()) as Loose;
    expect(got.tags).toEqual(['soup']);
  });

  it('415 for a non-JSON content type is unchanged', async () => {
    const res = await createPost(
      new Request('http://localhost:3100/api/recipes', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(415);
  });
});

describe('GET /api/tags', () => {
  it('401 without a session', async () => {
    state.current = null;
    expect((await tagsReq()).status).toBe(401);
  });

  it('returns names and counts, private no-store', async () => {
    await create({ tags: ['pasta', 'quick'] });
    await create({ tags: ['pasta'] });
    const res = await tagsReq();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      tags: [
        { name: 'pasta', count: 2 },
        { name: 'quick', count: 1 },
      ],
    });
  });

  it('a user never sees tags that exist only on another user private recipes', async () => {
    await create({ tags: ['secret-a', 'pasta'], visibility: 'private' });
    await create({ tags: ['pasta'], visibility: 'users' });
    state.current = other;
    const body = (await (await tagsReq()).json()) as { tags: { name: string; count: number }[] };
    expect(body.tags).toEqual([{ name: 'pasta', count: 1 }]);
    const prefixed = (await (await tagsReq('?q=sec')).json()) as { tags: unknown[] };
    expect(prefixed.tags).toEqual([]);
  });

  it('q filters by prefix, case-insensitively; LIKE characters are literal', async () => {
    await create({ tags: ['pasta', 'pizza', '100%'] });
    const names = async (qs: string) =>
      ((await (await tagsReq(qs)).json()) as { tags: { name: string }[] }).tags.map((t) => t.name);
    expect(await names('?q=P')).toEqual(['pasta', 'pizza']);
    expect(await names('?q=%25')).toEqual([]);
    expect(await names('?q=_')).toEqual([]);
    expect(await names('?q=100%25')).toEqual(['100%']);
  });

  it('400 when q is longer than 40 characters', async () => {
    expect((await tagsReq(`?q=${'a'.repeat(41)}`)).status).toBe(400);
    expect((await tagsReq(`?q=${'a'.repeat(40)}`)).status).toBe(200);
  });

  it('autocomplete returns at most 10', async () => {
    await create({ tags: Array.from({ length: 15 }, (_, i) => `zz${String(i).padStart(2, '0')}`) });
    const body = (await (await tagsReq('?q=zz')).json()) as { tags: unknown[] };
    expect(body.tags).toHaveLength(10);
  });
});

it('list endpoint is unchanged', async () => {
  await createPost(req('POST', { ...SAMPLE_SKILLET_COOKIES, tags: ['a'] }));
  const res = await listGet(req('GET'));
  expect(res.status).toBe(200);
});

describe('GET /api/recipes search params (T6)', () => {
  const list = async (qs: string, as: User = owner) => {
    state.current = as;
    const res = await listGet(
      new Request(`http://localhost:3100/api/recipes${qs}`, {
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
    );
    return { res, json: (await res.json()) as Loose };
  };
  it('q=espresso finds the sample; private hidden from another user; no-store', async () => {
    const { json: made } = await create({ visibility: 'private', tags: ['dessert'] });
    const mine = await list('?q=espresso');
    expect(mine.res.status).toBe(200);
    expect(mine.res.headers.get('cache-control')).toBe('private, no-store');
    expect(mine.json.recipes.map((r: Loose) => r.id)).toEqual([made.id]);
    expect(mine.json.recipes[0].tags).toEqual(['dessert']);
    for (const qs of [
      '?q=espresso',
      '?tag=dessert',
      `?author=${owner.id}`,
      '?q=espresso&tag=dessert',
    ]) {
      expect((await list(qs, other)).json.recipes).toEqual([]);
    }
    expect((await list(`?author=me&tag=dessert`)).json.recipes).toHaveLength(1);
  });
  it('rejects unknown, repeated and oversize params with 400 invalid_query', async () => {
    for (const qs of [
      '?min_rating=0',
      '?min_rating=6',
      '?min_rating=3.5',
      '?min_rating=x',
      '?min_rating=',
      '?min_rating=3&min_rating=4',
      '?foo=1',
      '?q=a&q=b',
      `?q=${'x'.repeat(101)}`,
      '?tag=',
      `?tag=${'t'.repeat(41)}`,
      '?author=nope',
      `?author=${owner.id.toLowerCase()}`,
      '?author=ME',
      `?tag=${'😀'.repeat(41)}`,
    ]) {
      const { res, json } = await list(qs);
      expect([qs, res.status]).toEqual([qs, 400]);
      expect(json).toEqual({ error: 'invalid_query' });
    }
  });
  it('length limits count code points: a 30-emoji tag and a 100-emoji q are accepted', async () => {
    const tag = '😀'.repeat(30);
    await create({ visibility: 'private', tags: [tag] });
    const r = await list(`?tag=${encodeURIComponent(tag)}`);
    expect(r.res.status).toBe(200);
    expect(r.json.recipes).toHaveLength(1);
    expect((await list(`?q=${encodeURIComponent('😀'.repeat(100))}`)).res.status).toBe(200);
  });
  it('hostile q values answer 200, never 500', async () => {
    await create({ visibility: 'users' });
    for (const q of [
      '" OR 1=1',
      'NEAR(a b)',
      'title:x',
      '*',
      '"',
      '(((',
      '😀',
      '%',
      '\u0000',
      'x'.repeat(100),
    ]) {
      expect((await list(`?q=${encodeURIComponent(q)}`, other)).res.status).toBe(200);
    }
  });
});
