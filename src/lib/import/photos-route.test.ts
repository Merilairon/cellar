import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { insertCoverPhoto } from '@/lib/db/photos';
import { createRecipe } from '@/lib/db/recipes';
import { photo, user } from '@/lib/db/schema';

const state = vi.hoisted(() => ({ db: undefined as unknown, current: null as unknown, dir: '' }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ BASE_URL: 'http://localhost:3100', UPLOADS_DIR: state.dir }),
}));

import { GET } from '@/app/api/photos/[id]/route';

let db: Db;
let dir: string;
let a: { id: string; role: 'member' };
let b: { id: string; role: 'member' };
const mk = (email: string) =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role: 'member' })
    .returning()
    .get();
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new Request('http://localhost:3100/api/photos/x'), ctx(id));
const mkPhoto = (visibility: 'private' | 'users', file = 'AAA.webp') => {
  const rid = createRecipe(db, a.id, {
    fields: { title: 'R', visibility, viewMode: 'list' },
    sections: [{ title: null, ingredients: [], steps: [] }],
  });
  writeFileSync(join(dir, file), 'webpbytes');
  return insertCoverPhoto(db, rid, { filePath: file, width: 1, height: 1 }).id;
};

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  dir = mkdtempSync(join(tmpdir(), 'ph-'));
  mkdirSync(dir, { recursive: true });
  state.dir = dir;
  a = mk('a@x.test') as typeof a;
  b = mk('b@x.test') as typeof b;
  state.current = a;
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/photos/:id', () => {
  it('serves the owner their photo with private, nosniff headers', async () => {
    const res = await get(mkPhoto('private'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('webpbytes');
  });
  it('404 for another user when the recipe is private, 200 when users-visible', async () => {
    const priv = mkPhoto('private');
    const shared = mkPhoto('users', 'BBB.webp');
    state.current = b;
    expect((await get(priv)).status).toBe(404);
    expect((await get(shared)).status).toBe(200);
  });
  it('401 anonymous, 404 unknown id, 404 when the stored path escapes uploads', async () => {
    const id = mkPhoto('private');
    state.current = null;
    expect((await get(id)).status).toBe(401);
    state.current = a;
    expect((await get('nope')).status).toBe(404);
    db.update(photo).set({ filePath: '../../etc/passwd' }).run();
    expect((await get(id)).status).toBe(404);
  });
});
