import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { rating, recipe, user } from '@/lib/db/schema';
import type { User } from '@/lib/db/users';
import { SAMPLE_SKILLET_COOKIES } from './samples';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => ({ BASE_URL: 'http://localhost:3100' }) }));

import { GET as listGet, POST as createRecipePost } from '@/app/api/recipes/route';
import { GET as recipeGet } from '@/app/api/recipes/[id]/route';
import { PUT as gridPut } from '@/app/api/recipes/[id]/grid/route';
import { DELETE as ratingDelete, PUT as ratingPut } from '@/app/api/recipes/[id]/rating/route';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: Db;
let owner: User;
let alice: User;
let bob: User;
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
const same = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (rid: string, body: unknown, headers: Record<string, string> = same, raw?: string) =>
  ratingPut(
    new Request('http://localhost:3100/api/recipes/x/rating', {
      method: 'PUT',
      headers,
      body: raw ?? JSON.stringify(body),
    }),
    ctx(rid),
  );
const del = (rid: string, headers: Record<string, string> = same) =>
  ratingDelete(
    new Request('http://localhost:3100/api/recipes/x/rating', { method: 'DELETE', headers }),
    ctx(rid),
  );
const get = (u: User, rid: string) => {
  as(u);
  return recipeGet(
    new Request('http://localhost:3100/api/recipes/x', {
      headers: { 'sec-fetch-site': 'same-origin' },
    }),
    ctx(rid),
  ).then((r) => r.json() as Promise<Loose>);
};
const list = async (u: User, qs = ''): Promise<{ status: number; recipes: Loose[] }> => {
  as(u);
  const res = await listGet(
    new Request(`http://localhost:3100/api/recipes${qs}`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    }),
  );
  const j = (await res.json()) as Loose;
  return { status: res.status, recipes: j.recipes ?? [] };
};
async function makeRecipe(
  visibility: 'private' | 'users',
  extra: Loose = {},
  by: User = owner,
): Promise<string> {
  as(by);
  const res = await createRecipePost(
    new Request('http://localhost:3100/api/recipes', {
      method: 'POST',
      headers: same,
      body: JSON.stringify({ ...SAMPLE_SKILLET_COOKIES, visibility, ...extra }),
    }),
  );
  return ((await res.json()) as { id: string }).id;
}
async function rate(u: User, rid: string, stars: number) {
  as(u);
  const res = await put(rid, { stars });
  expect(res.status).toBe(200);
  return (await res.json()) as Loose;
}
/** Insert raw ratings with an exact star list (one fake user per entry). */
function seed(rid: string, stars: number[]) {
  stars.forEach((s, i) => {
    const u = mk(`seed${rid}${i}`);
    db.insert(rating).values({ recipeId: rid, userId: u.id, stars: s }).run();
  });
}

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  owner = mk('owner');
  alice = mk('alice');
  bob = mk('bob');
  admin = mk('admin', 'admin');
});
afterEach(() => db.$client.close());

describe('PUT/DELETE rating: validation and authorization', () => {
  it('accepts only integers 1..5, everything else is 422', async () => {
    const rid = await makeRecipe('users');
    as(alice);
    for (const stars of [1, 2, 3, 4, 5]) expect((await put(rid, { stars })).status).toBe(200);
    for (const body of [
      { stars: 0 },
      { stars: 6 },
      { stars: 3.5 },
      { stars: '3' },
      { stars: null },
      {},
      { stars: 3, user_id: bob.id },
      [],
      'x',
    ]) {
      const res = await put(rid, body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 422]);
      expect(((await res.json()) as Loose).errors.length).toBeGreaterThan(0);
    }
    expect((await get(alice, rid)).my_rating).toBe(5);
  });

  it('401, 403 (CSRF), 415, 400 and 404 ordering', async () => {
    const rid = await makeRecipe('users');
    as(null);
    expect((await put(rid, { stars: 3 })).status).toBe(401);
    expect((await del(rid)).status).toBe(401);
    as(alice);
    const cross = { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' };
    expect((await put(rid, { stars: 3 }, cross)).status).toBe(403);
    expect((await del(rid, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(
      (
        await put(
          rid,
          { stars: 3 },
          { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
        )
      ).status,
    ).toBe(415);
    expect((await put(rid, null, same, '{nope')).status).toBe(400);
    expect((await put('missing', { stars: 3 })).status).toBe(404);
    expect((await del('missing')).status).toBe(404);
    expect((await get(alice, rid)).my_rating).toBeNull();
  });

  it('any reader may rate: own recipe, read-only users recipe, admin', async () => {
    const rid = await makeRecipe('users');
    expect((await rate(owner, rid, 5)).my_rating).toBe(5);
    expect((await rate(alice, rid, 3)).my_rating).toBe(3);
    expect((await rate(admin, rid, 1)).my_rating).toBe(1);
    expect(await get(bob, rid)).toMatchObject({ rating_count: 3, my_rating: null });
  });

  it('a private foreign recipe is 404 for PUT and DELETE and never returned however rated', async () => {
    const rid = await makeRecipe('private');
    seed(rid, [5, 5]);
    as(alice);
    expect((await put(rid, { stars: 5 })).status).toBe(404);
    expect((await del(rid)).status).toBe(404);
    expect(db.select().from(rating).where(eq(rating.userId, alice.id)).all()).toEqual([]);
    expect((await list(alice)).recipes).toEqual([]);
    expect((await list(alice, '?min_rating=1')).recipes).toEqual([]);
    expect((await list(alice, '?min_rating=5&q=skillet')).recipes).toEqual([]);
  });

  it('upsert is idempotent, user_id is the session user, one row per user', async () => {
    const rid = await makeRecipe('users');
    await rate(alice, rid, 2);
    await rate(alice, rid, 2);
    const r = await rate(alice, rid, 4);
    expect(r).toEqual({ rating_avg: 4, rating_count: 1, my_rating: 4 });
    expect(db.select().from(rating).all()).toHaveLength(1);
    expect(db.select().from(rating).get()!.userId).toBe(alice.id);
  });
});

describe('aggregate on detail and list', () => {
  it('0, 1, 2 raters, update and delete; other raters never exposed', async () => {
    const rid = await makeRecipe('users');
    expect(await get(alice, rid)).toMatchObject({
      rating_avg: null,
      rating_count: 0,
      my_rating: null,
    });
    await rate(alice, rid, 4);
    expect(await get(bob, rid)).toMatchObject({ rating_avg: 4, rating_count: 1, my_rating: null });
    await rate(bob, rid, 1);
    const d = await get(alice, rid);
    expect(d).toMatchObject({ rating_avg: 2.5, rating_count: 2, my_rating: 4 });
    expect(JSON.stringify(d)).not.toContain(bob.id);
    await rate(bob, rid, 5);
    expect(await get(alice, rid)).toMatchObject({ rating_avg: 4.5, rating_count: 2 });
    as(bob);
    expect((await del(rid)).status).toBe(204);
    expect((await del(rid)).status).toBe(204); // idempotent
    expect(await get(alice, rid)).toMatchObject({ rating_avg: 4, rating_count: 1, my_rating: 4 });
    const item = (await list(alice)).recipes.find((r) => r.id === rid)!;
    expect(item).toMatchObject({ rating_avg: 4, rating_count: 1 });
    expect(Object.keys(item)).not.toContain('my_rating');
    as(alice);
    await del(rid);
    expect((await list(alice)).recipes[0]).toMatchObject({ rating_avg: null, rating_count: 0 });
  });

  it("a deleted user's rating disappears from the aggregate", async () => {
    const rid = await makeRecipe('users');
    await rate(alice, rid, 1);
    await rate(bob, rid, 5);
    db.delete(user).where(eq(user.id, alice.id)).run();
    expect(await get(bob, rid)).toMatchObject({ rating_avg: 5, rating_count: 1 });
  });

  it('statement count does not grow with the number of recipes', async () => {
    const count = async () => {
      const spy = vi.spyOn(db.$client, 'prepare');
      await list(alice);
      const n = spy.mock.calls.length;
      spy.mockRestore();
      return n;
    };
    const first = await makeRecipe('users');
    seed(first, [3]);
    const few = await count();
    for (let i = 0; i < 25; i++) seed(await makeRecipe('users', { title: `R${i}` }), [4, 5]);
    expect((await list(alice)).recipes).toHaveLength(26);
    expect(await count()).toBe(few);
  });
});

describe('min_rating', () => {
  it('rejects anything but a single integer 1..5 with 400 invalid_query', async () => {
    for (const qs of ['0', '6', '3.5', 'x', '', '-1', '+3', '03', '3&min_rating=4', '1e0']) {
      const res = await (async () => {
        as(alice);
        return listGet(
          new Request(`http://localhost:3100/api/recipes?min_rating=${qs}`, {
            headers: { 'sec-fetch-site': 'same-origin' },
          }),
        );
      })();
      expect([qs, res.status]).toEqual([qs, 400]);
      expect(await res.json()).toEqual({ error: 'invalid_query' });
    }
  });

  it('is inclusive on the stored average, 4.0 vs 3.99, excludes unrated', async () => {
    const four = await makeRecipe('users', { title: 'Four' });
    const almost = await makeRecipe('users', { title: 'Almost' });
    await makeRecipe('users', { title: 'Unrated' });
    seed(four, [4, 4, 4]);
    // 4,4,4,... 99 x 4 + 1 x 3 would be 3.99; use 100 raters for exactness.
    seed(almost, [...Array<number>(99).fill(4), 3]);
    const titles = async (n: number) =>
      (await list(alice, `?min_rating=${n}`)).recipes.map((r) => r.title);
    expect(await titles(4)).toEqual(['Four']);
    expect(await titles(3)).toEqual(['Almost', 'Four']);
    expect(await titles(5)).toEqual([]);
    const all = (await list(alice)).recipes;
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.title === 'Almost')!.rating_avg).toBeCloseTo(3.99, 5);
  });

  it('ANDs with q, tag and author; does not change ranking', async () => {
    const a = await makeRecipe('users', { title: 'Lemon tart', tags: ['dessert'] });
    const b = await makeRecipe('users', { title: 'Lemon soup', tags: ['soup'] }, bob);
    const c = await makeRecipe('users', { title: 'Lemon cake', tags: ['dessert'] });
    seed(a, [5]);
    seed(b, [5]);
    seed(c, [2]);
    const ids = async (qs: string) => (await list(alice, qs)).recipes.map((r) => r.id).sort();
    expect(await ids('?min_rating=4&q=lemon')).toEqual([a, b].sort());
    expect(await ids('?min_rating=4&q=lemon&tag=dessert')).toEqual([a]);
    expect(await ids(`?min_rating=4&q=lemon&author=${bob.id}`)).toEqual([b]);
    expect(await ids(`?min_rating=4&author=${owner.id}`)).toEqual([a]);
    const order = async (qs: string) => (await list(alice, qs)).recipes.map((r) => r.id);
    const ranked = (await order('?q=lemon')).filter((id) => id !== c);
    expect(await order('?q=lemon&min_rating=4')).toEqual(ranked);
  });
});

describe('G5: ratings do not touch recipe.updated_at or list order', () => {
  it('keeps updated_at and order, and a stale grid base still saves', async () => {
    const older = await makeRecipe('users', { title: 'Older' });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await makeRecipe('users', { title: 'Newer' });
    const stamp = (id: string) =>
      db.select().from(recipe).where(eq(recipe.id, id)).get()!.updatedAt;
    const before = [stamp(older), stamp(newer)];
    const order = (await list(alice)).recipes.map((r) => r.id);
    expect(order).toEqual([newer, older]);
    await rate(alice, older, 5);
    as(bob);
    await del(older);
    await rate(bob, older, 1);
    expect([stamp(older), stamp(newer)]).toEqual(before);
    expect((await list(alice)).recipes.map((r) => r.id)).toEqual(order);

    const base = await get(owner, older);
    await rate(alice, older, 3);
    as(owner);
    const res = await gridPut(
      new Request('http://localhost:3100/api/recipes/x/grid', {
        method: 'PUT',
        headers: same,
        body: JSON.stringify({
          base_updated_at: base.updated_at,
          title: base.title,
          servings: base.servings,
          sections: base.sections.map((s: Loose) => ({
            id: s.id,
            title: s.title,
            ingredients: s.ingredients,
            steps: s.steps,
          })),
        }),
      }),
      ctx(older),
    );
    expect(res.status).not.toBe(409);
    expect(await get(alice, older)).toMatchObject({ my_rating: 3, rating_count: 2 });
  });
});
