import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { note, recipe, user } from '@/lib/db/schema';
import type { User } from '@/lib/db/users';
import { SAMPLE_SKILLET_COOKIES } from './samples';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({ getEnv: () => ({ BASE_URL: 'http://localhost:3100' }) }));

import { POST as createRecipePost } from '@/app/api/recipes/route';
import { GET as recipeGet } from '@/app/api/recipes/[id]/route';
import { PUT as gridPut } from '@/app/api/recipes/[id]/grid/route';
import { GET as notesGet, POST as notesPost } from '@/app/api/recipes/[id]/notes/route';
import { DELETE as noteDelete, PUT as notePut } from '@/app/api/recipes/[id]/notes/[noteId]/route';

type Item = {
  id: string;
  body: string;
  shared: boolean;
  author: string;
  mine: boolean;
  created_at: string;
  updated_at: string;
};

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
const url = 'http://localhost:3100/api/recipes/x/notes';
const req = (
  method: string,
  body?: unknown,
  headers: Record<string, string> = same,
  raw?: string,
) =>
  new Request(url, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const ctx = (id: string, noteId = '') => ({ params: Promise.resolve({ id, noteId }) });

async function makeRecipe(visibility: 'private' | 'users'): Promise<string> {
  as(owner);
  const res = await createRecipePost(req('POST', { ...SAMPLE_SKILLET_COOKIES, visibility }));
  return ((await res.json()) as { id: string }).id;
}
async function add(u: User, rid: string, body: string, shared = false): Promise<Item> {
  as(u);
  const res = await notesPost(req('POST', { body, shared }), ctx(rid));
  expect(res.status).toBe(201);
  return (await res.json()) as Item;
}
async function list(u: User, rid: string): Promise<Item[]> {
  as(u);
  const res = await notesGet(req('GET', undefined, { 'sec-fetch-site': 'same-origin' }), ctx(rid));
  expect(res.status).toBe(200);
  return ((await res.json()) as { notes: Item[] }).notes;
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

describe('notes authorization matrix', () => {
  it('private-note visibility: two users, same recipe, never the other private note', async () => {
    const rid = await makeRecipe('users');
    await add(alice, rid, 'alice private');
    await add(alice, rid, 'alice shared', true);
    await add(bob, rid, 'bob private');
    expect((await list(alice, rid)).map((n) => n.body)).toEqual(['alice private', 'alice shared']);
    const forBob = await list(bob, rid);
    expect(forBob.map((n) => n.body)).toEqual(['alice shared', 'bob private']);
    expect(forBob.map((n) => [n.author, n.mine])).toEqual([
      ['alice', false],
      ['bob', true],
    ]);
    expect(JSON.stringify(forBob)).not.toContain('alice private');
  });

  it('owner and admin never see other users private notes', async () => {
    const rid = await makeRecipe('users');
    await add(alice, rid, 'secret');
    await add(alice, rid, 'public', true);
    for (const u of [owner, admin]) {
      expect((await list(u, rid)).map((n) => n.body)).toEqual(['public']);
    }
  });

  it('a read-only users recipe accepts notes from any reader', async () => {
    const rid = await makeRecipe('users');
    const n = await add(bob, rid, 'hello', true);
    expect(n).toMatchObject({ mine: true, shared: true, author: 'bob' });
  });

  it('private foreign recipe is 404 for list, create, edit and delete', async () => {
    const rid = await makeRecipe('private');
    as(alice);
    expect((await notesGet(req('GET', undefined, same), ctx(rid))).status).toBe(404);
    expect((await notesPost(req('POST', { body: 'x' }), ctx(rid))).status).toBe(404);
    expect((await notePut(req('PUT', { body: 'x' }), ctx(rid, 'n'))).status).toBe(404);
    expect((await noteDelete(req('DELETE'), ctx(rid, 'n'))).status).toBe(404);
    // admin can read any recipe
    expect((await add(admin, rid, 'admin note')).mine).toBe(true);
  });

  it('missing recipe is 404', async () => {
    as(alice);
    expect((await notesGet(req('GET', undefined, same), ctx('nope'))).status).toBe(404);
  });

  it('unauthenticated is 401, CSRF failure is 403 before the session check', async () => {
    const rid = await makeRecipe('users');
    as(null);
    expect((await notesGet(req('GET', undefined, same), ctx(rid))).status).toBe(401);
    expect((await notesPost(req('POST', { body: 'x' }), ctx(rid))).status).toBe(401);
    expect(
      (
        await notesPost(
          req('POST', { body: 'x' }, { ...same, 'sec-fetch-site': 'cross-site' }),
          ctx(rid),
        )
      ).status,
    ).toBe(403);
    as(alice);
    expect(
      (
        await notesPost(
          req('POST', { body: 'x' }, { 'content-type': 'application/json' }),
          ctx(rid),
        )
      ).status,
    ).toBe(403);
  });

  it('only the author edits; another user (incl. owner and admin) gets 404', async () => {
    const rid = await makeRecipe('users');
    const priv = await add(alice, rid, 'p');
    const shared = await add(alice, rid, 's', true);
    for (const u of [bob, owner, admin]) {
      as(u);
      for (const n of [priv, shared]) {
        expect((await notePut(req('PUT', { body: 'hijack' }), ctx(rid, n.id))).status).toBe(404);
      }
    }
    as(alice);
    const ok = await notePut(req('PUT', { body: ' edited ', shared: true }), ctx(rid, priv.id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ body: 'edited', shared: true });
    expect((await list(bob, rid)).map((n) => n.body)).toEqual(['edited', 's']);
  });

  it('delete: author; owner/admin only for SHARED notes; others 404 with no probe', async () => {
    const rid = await makeRecipe('users');
    const priv = await add(alice, rid, 'p');
    const shared = await add(alice, rid, 's', true);
    const del = async (u: User, id: string) => (
      as(u),
      (await noteDelete(req('DELETE'), ctx(rid, id))).status
    );
    expect(await del(bob, shared.id)).toBe(404);
    expect(await del(bob, priv.id)).toBe(404);
    expect(await del(owner, priv.id)).toBe(404);
    expect(await del(admin, priv.id)).toBe(404);
    expect(await del(owner, 'missing')).toBe(404);
    expect(db.select().from(note).all()).toHaveLength(2);
    expect(await del(owner, shared.id)).toBe(204);
    const s2 = await add(alice, rid, 's2', true);
    expect(await del(admin, s2.id)).toBe(204);
    expect(await del(alice, priv.id)).toBe(204);
    expect(db.select().from(note).all()).toHaveLength(0);
  });

  it('a note id from another recipe is 404 on PUT and DELETE', async () => {
    const r1 = await makeRecipe('users');
    const r2 = await makeRecipe('users');
    const n = await add(alice, r1, 'x');
    as(alice);
    expect((await notePut(req('PUT', { body: 'y' }), ctx(r2, n.id))).status).toBe(404);
    expect((await noteDelete(req('DELETE'), ctx(r2, n.id))).status).toBe(404);
    expect(db.select().from(note).where(eq(note.id, n.id)).get()?.body).toBe('x');
  });

  it('a recipe that became private hides notes from a former reader (in-route re-check)', async () => {
    const rid = await makeRecipe('users');
    const n = await add(alice, rid, 'x', true);
    db.update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, rid)).run();
    as(alice);
    expect((await notePut(req('PUT', { body: 'y' }), ctx(rid, n.id))).status).toBe(404);
    expect((await noteDelete(req('DELETE'), ctx(rid, n.id))).status).toBe(404);
  });

  it('deleting the author cascades their notes (Q14)', async () => {
    const rid = await makeRecipe('users');
    await add(alice, rid, 'x', true);
    db.delete(user).where(eq(user.id, alice.id)).run();
    expect(await list(bob, rid)).toEqual([]);
  });
});

describe('notes validation', () => {
  it('rejects bad content-type 415, oversize 413 (header and stream), bad JSON 400', async () => {
    const rid = await makeRecipe('users');
    as(alice);
    expect(
      (
        await notesPost(
          req('POST', { body: 'x' }, { ...same, 'content-type': 'text/plain' }),
          ctx(rid),
        )
      ).status,
    ).toBe(415);
    const big = JSON.stringify({ body: 'a'.repeat(20 * 1024) });
    expect((await notesPost(req('POST', undefined, same, big), ctx(rid))).status).toBe(413);
    expect(
      (
        await notesPost(
          req('POST', undefined, { ...same, 'content-length': '99999' }, '{}'),
          ctx(rid),
        )
      ).status,
    ).toBe(413);
    expect((await notesPost(req('POST', undefined, same, '{nope'), ctx(rid))).status).toBe(400);
  });

  it('422 with paths: empty, whitespace, too long, wrong types, unknown keys, NUL', async () => {
    const rid = await makeRecipe('users');
    as(alice);
    const post = async (b: unknown) => {
      const res = await notesPost(req('POST', b), ctx(rid));
      return { status: res.status, errors: ((await res.json()) as { errors: unknown[] }).errors };
    };
    expect(await post({ body: '' })).toMatchObject({
      status: 422,
      errors: [{ path: 'body', code: 'too_small' }],
    });
    expect((await post({ body: '   \n ' })).status).toBe(422);
    expect(await post({ body: 'a'.repeat(4001) })).toMatchObject({
      errors: [{ path: 'body', code: 'too_big' }],
    });
  });

  it('accepts exactly 4000 characters; rejects unknown keys, NUL, non-boolean shared', async () => {
    const rid = await makeRecipe('users');
    as(alice);
    const status = async (b: unknown) => (await notesPost(req('POST', b), ctx(rid))).status;
    expect(await status({ body: 'a'.repeat(4000) })).toBe(201);
    expect(await status({ body: 'x', user_id: bob.id })).toBe(422);
    expect(await status({ body: 'x', recipe_id: 'r' })).toBe(422);
    expect(await status({ body: 'a\u0000b' })).toBe(422);
    expect(await status({ body: 'x', shared: 'yes' })).toBe(422);
    expect(await status({ body: 5 })).toBe(422);
    expect(await status(['x'])).toBe(422);
    expect(await status({})).toBe(422);
    const res = await notesPost(req('POST', { body: 'a\u0000b' }), ctx(rid));
    expect(await res.json()).toEqual({ errors: [{ path: 'body', code: 'nul_char' }] });
  });

  it('PUT needs at least one field and rejects unknown keys', async () => {
    const rid = await makeRecipe('users');
    const n = await add(alice, rid, 'x');
    as(alice);
    expect((await notePut(req('PUT', {}), ctx(rid, n.id))).status).toBe(422);
    expect((await notePut(req('PUT', { user_id: bob.id }), ctx(rid, n.id))).status).toBe(422);
    expect((await notePut(req('PUT', { shared: true }), ctx(rid, n.id))).status).toBe(200);
  });

  it('limit: the 201st note by one user is note_limit; other users are unaffected', async () => {
    const rid = await makeRecipe('users');
    for (let i = 0; i < 200; i++) {
      db.insert(note)
        .values({ recipeId: rid, userId: alice.id, body: `n${i}` })
        .run();
    }
    as(alice);
    const res = await notesPost(req('POST', { body: 'one too many' }), ctx(rid));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors: [{ path: 'body', code: 'note_limit' }] });
    expect((await add(bob, rid, 'fine')).body).toBe('fine');
    const other = await makeRecipe('users');
    expect((await add(alice, other, 'other recipe')).body).toBe('other recipe');
  });

  it('XSS string and whitespace round-trip unchanged as data', async () => {
    const rid = await makeRecipe('users');
    const xss = '<img src=x onerror=alert(1)>\n  line two\t& "quotes" <script>x</script>';
    const n = await add(alice, rid, xss, true);
    expect(n.body).toBe(xss);
    expect((await list(bob, rid))[0].body).toBe(xss);
    expect(db.select().from(note).get()?.body).toBe(xss);
  });

  it('responses are no-store and list is ordered by created_at, id', async () => {
    const rid = await makeRecipe('users');
    db.insert(note)
      .values({
        id: 'b',
        recipeId: rid,
        userId: alice.id,
        body: '2',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      .run();
    db.insert(note)
      .values({
        id: 'a',
        recipeId: rid,
        userId: alice.id,
        body: '3',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      .run();
    db.insert(note)
      .values({
        id: 'z',
        recipeId: rid,
        userId: alice.id,
        body: '1',
        createdAt: '2025-01-01T00:00:00.000Z',
      })
      .run();
    expect((await list(alice, rid)).map((n) => n.body)).toEqual(['1', '3', '2']);
    as(alice);
    const res = await notesGet(req('GET', undefined, same), ctx(rid));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

const fts = (id: string) =>
  db.$client.prepare('SELECT * FROM recipe_fts WHERE recipe_id = ?').all(id);

describe('notes do not touch the recipe', () => {
  it('leave recipe.updated_at unchanged and a stale grid base still saves (G5)', async () => {
    const rid = await makeRecipe('users');
    const before = db.select().from(recipe).where(eq(recipe.id, rid)).get()!;
    const ftsBefore = fts(rid);
    const n = await add(alice, rid, 'one', true);
    as(alice);
    await notePut(req('PUT', { body: 'two' }), ctx(rid, n.id));
    await noteDelete(req('DELETE'), ctx(rid, n.id));
    await add(bob, rid, 'three');
    const after = db.select().from(recipe).where(eq(recipe.id, rid)).get()!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(fts(rid)).toEqual(ftsBefore);
    // grid save with the stale base: 200, not 409
    as(owner);
    const got = (await (await recipeGet(req('GET', undefined, same), ctx(rid))).json()) as {
      sections: unknown[];
    };
    const res = await gridPut(
      req('PUT', { base_updated_at: before.updatedAt, sections: got.sections }),
      ctx(rid),
    );
    expect(res.status).toBe(200);
  });
});

describe('notes read the recipe check before the body (AppSec L3)', () => {
  it('unreadable recipe is 404 for POST and PUT whatever the body or content type', async () => {
    const rid = await makeRecipe('private');
    as(alice);
    const bad = new Request(url, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
      body: '{',
    });
    expect((await notesPost(bad, ctx(rid))).status).toBe(404);
    expect((await notesPost(req('POST', { body: 'x' }), ctx(rid))).status).toBe(404);
    expect((await notePut(req('PUT', { body: 'x' }), ctx(rid, 'n1'))).status).toBe(404);
    expect((await notesPost(req('POST', { body: 'x' }), ctx('missing'))).status).toBe(404);
    const res = await notesPost(req('POST', { body: 'x' }), ctx(rid));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('the body is not read for an unreadable recipe', async () => {
    const rid = await makeRecipe('private');
    as(alice);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled++;
        },
      },
      { highWaterMark: 0 },
    );
    const mkReq = (method: string) =>
      new Request(url, { method, headers: same, body: stream, duplex: 'half' } as RequestInit);
    expect((await notesPost(mkReq('POST'), ctx(rid))).status).toBe(404);
    expect((await notePut(mkReq('PUT'), ctx(rid, 'n1'))).status).toBe(404);
    expect(pulled).toBe(0);
  });

  it('a readable recipe still validates the body (415, 400, 422)', async () => {
    const rid = await makeRecipe('users');
    as(alice);
    const wrongType = new Request(url, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
      body: '{}',
    });
    expect((await notesPost(wrongType, ctx(rid))).status).toBe(415);
    expect((await notesPost(req('POST', undefined, same, '{'), ctx(rid))).status).toBe(400);
    expect((await notesPost(req('POST', { body: '' }), ctx(rid))).status).toBe(422);
  });
});
