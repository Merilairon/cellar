import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { recipe, user } from '@/lib/db/schema';
import type { User } from '@/lib/db/users';
import { getRecipeRow } from '@/lib/db/recipes';
import { canView } from './access';
import { copyRecipeFor } from './service';
import { SHARE_TOKEN_RE, generateShareToken, shareUrl } from './share';
import { SAMPLE_SKILLET_COOKIES } from './samples';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  current: null as unknown,
  linksEnabled: true,
}));
const logs = vi.hoisted(() => [] as unknown[][]);
vi.mock('@/lib/log', () => ({ log: (...a: unknown[]) => logs.push(a) }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ BASE_URL: 'http://localhost:3100', PUBLIC_LINKS_ENABLED: state.linksEnabled }),
}));

import { GET as listGet, POST as createPost } from '@/app/api/recipes/route';
import { GET, PUT } from '@/app/api/recipes/[id]/route';
import { POST, DELETE } from '@/app/api/recipes/[id]/share-link/route';

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
  state.linksEnabled = true;
  logs.length = 0;
  owner = mk('o@x.test');
  other = mk('x@x.test');
  state.current = owner;
});
afterEach(() => db.$client.close());

const same = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const req = (method: string, headers: Record<string, string> = same) =>
  new Request('http://localhost:3100/api/recipes', { method, headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const make = async (over: Loose = {}): Promise<string> => {
  const res = await createPost(
    new Request('http://localhost:3100/api/recipes', {
      method: 'POST',
      headers: same,
      body: JSON.stringify({ ...SAMPLE_SKILLET_COOKIES, ...over }),
    }),
  );
  return ((await res.json()) as { id: string }).id;
};
const stored = (id: string) => getRecipeRow(db, id)!;
const getJson = async (id: string) => (await (await GET(req('GET', {}), ctx(id))).json()) as Loose;
const NO_STORE = 'private, no-store';

describe('share token helpers', () => {
  it('22 chars, base64url alphabet, 1000 distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const t = generateShareToken();
      expect(t).toHaveLength(22);
      expect(SHARE_TOKEN_RE.test(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(1000);
  });

  it('shareUrl trims trailing slashes', () => {
    expect(shareUrl('http://h:1/', 'abc')).toBe('http://h:1/r/abc');
    expect(shareUrl('http://h:1', 'abc')).toBe('http://h:1/r/abc');
  });
});

describe('POST/DELETE /api/recipes/:id/share-link', () => {
  it('owner creates (201) and revokes (204); both no-store', async () => {
    const id = await make();
    const res = await POST(req('POST'), ctx(id));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    const body = (await res.json()) as Loose;
    expect(body.share).toEqual({
      enabled: true,
      token: stored(id).shareToken,
      url: `http://localhost:3100/r/${stored(id).shareToken}`,
    });
    expect(SHARE_TOKEN_RE.test(body.share.token)).toBe(true);
    const del = await DELETE(req('DELETE'), ctx(id));
    expect(del.status).toBe(204);
    expect(del.headers.get('cache-control')).toBe(NO_STORE);
    expect(stored(id).shareToken).toBeNull();
  });

  it('authorization matrix', async () => {
    const shared = await make({ visibility: 'users' });
    const priv = await make({ visibility: 'private' });
    state.current = other;
    for (const [fn, m] of [
      [POST, 'POST'],
      [DELETE, 'DELETE'],
    ] as const) {
      expect((await fn(req(m), ctx(shared))).status).toBe(403);
      expect((await fn(req(m), ctx(priv))).status).toBe(404);
      expect((await fn(req(m), ctx('NOPE'))).status).toBe(404);
    }
    expect(stored(shared).shareToken).toBeNull();
    state.current = mk('adm@x.test', 'admin');
    expect((await POST(req('POST'), ctx(priv))).status).toBe(201);
    expect((await DELETE(req('DELETE'), ctx(priv))).status).toBe(204);
    state.current = null;
    const anon = await POST(req('POST'), ctx(priv));
    expect(anon.status).toBe(401);
    expect(anon.headers.get('cache-control')).toBe(NO_STORE);
    expect((await DELETE(req('DELETE'), ctx(priv))).status).toBe(401);
  });

  it('missing or cross-origin CSRF proof is 403 before any work', async () => {
    const id = await make();
    state.current = null; // would be 401 if auth ran first
    for (const headers of [{} as Record<string, string>, { 'sec-fetch-site': 'cross-site' }]) {
      expect((await POST(req('POST', headers), ctx(id))).status).toBe(403);
      expect((await DELETE(req('DELETE', headers), ctx(id))).status).toBe(403);
    }
    state.current = owner;
    expect((await POST(req('POST', {}), ctx(id))).status).toBe(403);
    expect(stored(id).shareToken).toBeNull();
  });

  it('rotate replaces the token and the old one no longer grants access', async () => {
    const id = await make();
    await POST(req('POST'), ctx(id));
    const old = stored(id).shareToken!;
    expect(canView(null, stored(id), { token: old, publicLinksEnabled: true })).toBe(true);
    expect((await POST(req('POST'), ctx(id))).status).toBe(201);
    const next = stored(id).shareToken!;
    expect(next).not.toBe(old);
    expect(canView(null, stored(id), { token: old, publicLinksEnabled: true })).toBe(false);
    expect(canView(null, stored(id), { token: next, publicLinksEnabled: true })).toBe(true);
  });

  it('revoke clears the token; revoking twice is 204', async () => {
    const id = await make();
    await POST(req('POST'), ctx(id));
    const old = stored(id).shareToken!;
    expect((await DELETE(req('DELETE'), ctx(id))).status).toBe(204);
    expect((await DELETE(req('DELETE'), ctx(id))).status).toBe(204);
    expect(stored(id).shareToken).toBeNull();
    expect(canView(null, stored(id), { token: old, publicLinksEnabled: true })).toBe(false);
  });

  it('PUBLIC_LINKS_ENABLED=false: POST is 403 public_links_disabled and changes nothing', async () => {
    const id = await make();
    await POST(req('POST'), ctx(id));
    const token = stored(id).shareToken;
    state.linksEnabled = false;
    const res = await POST(req('POST'), ctx(id));
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect(await res.json()).toEqual({ error: 'public_links_disabled' });
    expect(stored(id).shareToken).toBe(token);
    expect((await getJson(id)).public_links_enabled).toBe(false);
  });

  it('PUBLIC_LINKS_ENABLED=false: DELETE still revokes, so re-enabling cannot revive the link (m1)', async () => {
    const id = await make();
    await POST(req('POST'), ctx(id));
    state.linksEnabled = false;
    const res = await DELETE(req('DELETE'), ctx(id));
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect(stored(id).shareToken).toBeNull();
    state.linksEnabled = true;
    expect((await getJson(id)).share).toEqual({ enabled: false, token: null, url: null });
    // Still authenticated and owned: a stranger is refused even while disabled.
    state.current = other;
    expect((await DELETE(req('DELETE'), ctx(id))).status).toBe(404);
  });

  it('updated_at is byte-identical across create, rotate and revoke (R5)', async () => {
    const id = await make();
    const before = stored(id).updatedAt;
    await POST(req('POST'), ctx(id));
    expect(stored(id).updatedAt).toBe(before);
    await POST(req('POST'), ctx(id));
    expect(stored(id).updatedAt).toBe(before);
    await DELETE(req('DELETE'), ctx(id));
    expect(stored(id).updatedAt).toBe(before);
  });
});

describe('share state in responses', () => {
  it('GET carries share for can_edit only; url is BASE_URL/r/token; readers get null', async () => {
    const id = await make({ visibility: 'users' });
    expect((await getJson(id)).share).toEqual({ enabled: false, token: null, url: null });
    expect((await getJson(id)).public_links_enabled).toBe(true);
    await POST(req('POST'), ctx(id));
    const token = stored(id).shareToken!;
    const mine = await getJson(id);
    expect(mine.can_edit).toBe(true);
    expect(mine.share).toEqual({ enabled: true, token, url: `http://localhost:3100/r/${token}` });
    state.current = other;
    const theirs = await getJson(id);
    expect(theirs.can_edit).toBe(false);
    expect(theirs.share).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain(token);
  });

  it('the token never appears in list or search responses', async () => {
    const id = await make({ visibility: 'users' });
    await POST(req('POST'), ctx(id));
    const token = stored(id).shareToken!;
    for (const who of [owner, other]) {
      state.current = who;
      for (const url of [
        'http://localhost:3100/api/recipes',
        'http://localhost:3100/api/recipes?q=skillet',
      ]) {
        const res = await listGet(new Request(url, { headers: {} }));
        const text = await res.text();
        expect(text).toContain(id);
        expect(text).not.toContain(token);
      }
    }
  });

  it('admin sees the token; owner PUT keeps it and returns share; disabled hides it', async () => {
    const id = await make();
    await POST(req('POST'), ctx(id));
    const token = stored(id).shareToken!;
    const put = await PUT(
      new Request('http://localhost:3100/api/recipes', {
        method: 'PUT',
        headers: same,
        body: JSON.stringify({ ...SAMPLE_SKILLET_COOKIES, title: 'Renamed' }),
      }),
      ctx(id),
    );
    expect(put.status).toBe(200);
    expect(put.headers.get('cache-control')).toBe(NO_STORE);
    expect(((await put.json()) as Loose).share.token).toBe(token);
    expect(stored(id).shareToken).toBe(token);
    state.current = mk('adm@x.test', 'admin');
    expect((await getJson(id)).share.token).toBe(token);
    state.linksEnabled = false;
    expect((await getJson(id)).share).toEqual({ enabled: false, token: null, url: null });
    expect(stored(id).shareToken).toBe(token);
  });

  it('a copy has no share token and is private', async () => {
    const id = await make({ visibility: 'users' });
    await POST(req('POST'), ctx(id));
    const copy = copyRecipeFor(db, other, id) as { ok: true; id: string };
    const row = db.select().from(recipe).where(eq(recipe.id, copy.id)).get()!;
    expect(row.shareToken).toBeNull();
    expect(row.visibility).toBe('private');
  });
});

describe('share link log events (G18)', () => {
  it('created, rotated and revoked carry recipe and actor ids, never the token or url', async () => {
    const id = await make();
    logs.length = 0;
    const first = await POST(req('POST'), ctx(id));
    const token = ((await first.json()) as Loose).share.token as string;
    await POST(req('POST'), ctx(id));
    await DELETE(req('DELETE'), ctx(id));
    const fields = { recipe_id: id, actor_id: owner.id };
    expect(logs).toEqual([
      ['info', 'share_link.created', fields],
      ['info', 'share_link.rotated', fields],
      ['info', 'share_link.revoked', fields],
    ]);
    expect(JSON.stringify(logs)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain('/r/');
  });

  it('refused calls (disabled, not allowed, signed out) log nothing', async () => {
    const id = await make();
    logs.length = 0;
    state.linksEnabled = false;
    await POST(req('POST'), ctx(id));
    state.linksEnabled = true;
    state.current = other;
    await POST(req('POST'), ctx(id));
    await DELETE(req('DELETE'), ctx(id));
    state.current = null;
    await POST(req('POST'), ctx(id));
    expect(logs).toEqual([]);
  });

  it('revoking while links are disabled is logged too', async () => {
    const id = await make();
    await POST(req('POST'), ctx(id));
    logs.length = 0;
    state.linksEnabled = false;
    await DELETE(req('DELETE'), ctx(id));
    expect(logs).toEqual([['info', 'share_link.revoked', { recipe_id: id, actor_id: owner.id }]]);
  });
});
