import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { insertCoverPhoto } from '@/lib/db/photos';
import { createRecipe } from '@/lib/db/recipes';
import { photo, user } from '@/lib/db/schema';
import { resolveUploadPath } from '@/lib/import/uploads';
import { isAllowedEntryName } from '@/lib/backup/unzip';

// G21: one list of hostile names, run against every place a name or id becomes a path.
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  current: null as unknown,
  dir: '',
  reads: [] as string[],
}));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: async () => state.current }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ BASE_URL: 'http://localhost:3100', UPLOADS_DIR: state.dir }),
}));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  return {
    ...real,
    readFile: ((p: string, ...rest: unknown[]) => {
      state.reads.push(String(p));
      return (real.readFile as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as typeof real.readFile,
  };
});

import { GET } from '@/app/api/photos/[id]/route';

const HOSTILE = [
  '..',
  '../..',
  '../../etc/passwd',
  'a/../../b',
  'a/../..',
  './../x',
  '/etc/passwd',
  '/',
  'C:\\Windows\\win.ini',
  '..\\..\\x',
  'a\\..\\..\\x',
  'ok.webp\0.png',
  '\0',
  '%2e%2e/x',
  '%2e%2e%2fx',
  '..%2fx',
  '%252e%252e%252fx',
  '..%5cx',
  '\u2025/x', // two dot leader
  '\uff0e\uff0e/x', // fullwidth dots
  '.\u202e./x',
  ' ../x',
  '../'.repeat(500) + 'x',
  'a'.repeat(5000) + '/../../x',
  '',
];

/** Names that look hostile but stay inside as plain file names (never traversal). */
const INERT_INSIDE = ['%2e%2e/x', '%2e%2e%2fx', '..%2fx', '%252e%252e%252fx', '..%5cx', '\u2025/x'];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trav-'));
  state.dir = join(dir, 'uploads');
  mkdirSync(state.dir);
  state.reads = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveUploadPath: lexical rules', () => {
  const escapes = HOSTILE.filter((n) => !INERT_INSIDE.includes(n));
  it.each(escapes.map((n) => [JSON.stringify(n.slice(0, 40)), n]))('refuses %s', (_label, name) => {
    const got = resolveUploadPath(state.dir, name);
    // Either refused, or (names that only look odd) strictly inside the uploads dir.
    if (got !== null) expect(got.startsWith(state.dir + '/')).toBe(true);
  });

  it.each(['..', '../..', '../../etc/passwd', 'a/../../b', '/etc/passwd', '/', '', '\0'])(
    'returns null for the escape %j',
    (name) => {
      expect(resolveUploadPath(state.dir, name)).toBeNull();
    },
  );

  it('refuses a NUL byte anywhere in the name', () => {
    expect(resolveUploadPath(state.dir, 'ok.webp\0.png')).toBeNull();
    expect(resolveUploadPath(state.dir, 'a\0')).toBeNull();
  });

  it('refuses the uploads dir itself and any name that normalises to it', () => {
    expect(resolveUploadPath(state.dir, '.')).toBeNull();
    expect(resolveUploadPath(state.dir, 'a/..')).toBeNull();
  });

  it('keeps encoded, backslash and unicode-dot names inert: one file name inside the dir', () => {
    for (const n of INERT_INSIDE) {
      const got = resolveUploadPath(state.dir, n);
      // A leading `..` is refused conservatively; everything else is a plain name.
      if (n.startsWith('..')) {
        expect(got, n).toBeNull();
        continue;
      }
      expect(got, n).not.toBeNull();
      expect(got!.startsWith(state.dir + '/'), n).toBe(true);
      expect(got!, n).not.toContain('..' + '/');
    }
  });

  it('accepts ordinary names and nested names', () => {
    expect(resolveUploadPath(state.dir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.webp')).toBe(
      join(state.dir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.webp'),
    );
    expect(resolveUploadPath(state.dir, 'sub/x.webp')).toBe(join(state.dir, 'sub/x.webp'));
  });

  it('an overlong name is not a traversal and does not throw', () => {
    expect(() => resolveUploadPath(state.dir, 'a'.repeat(100_000))).not.toThrow();
    expect(resolveUploadPath(state.dir, '../'.repeat(10_000) + 'x')).toBeNull();
  });
});

describe('resolveUploadPath: symlinks (v0.5.1 review finding)', () => {
  let outside: string;
  beforeEach(() => {
    outside = join(dir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
  });

  it('refuses a file symlink inside uploads pointing outside', () => {
    symlinkSync(join(outside, 'secret.txt'), join(state.dir, 'evil.webp'));
    expect(resolveUploadPath(state.dir, 'evil.webp')).toBeNull();
  });

  it('refuses a directory symlink, for an existing and for a not-yet-existing file', () => {
    symlinkSync(outside, join(state.dir, 'linkdir'));
    expect(resolveUploadPath(state.dir, 'linkdir/secret.txt')).toBeNull();
    expect(resolveUploadPath(state.dir, 'linkdir/new.webp')).toBeNull();
    expect(resolveUploadPath(state.dir, 'linkdir/deep/er/new.webp')).toBeNull();
  });

  it('refuses a dangling symlink (a write through it would create the target)', () => {
    symlinkSync(join(outside, 'not-yet'), join(state.dir, 'dangling.webp'));
    expect(resolveUploadPath(state.dir, 'dangling.webp')).toBeNull();
  });

  it('refuses a relative symlink that climbs out', () => {
    symlinkSync('../outside/secret.txt', join(state.dir, 'rel.webp'));
    expect(resolveUploadPath(state.dir, 'rel.webp')).toBeNull();
  });

  it('allows a symlink that stays inside, and files that do not exist yet', () => {
    writeFileSync(join(state.dir, 'real.webp'), 'x');
    symlinkSync(join(state.dir, 'real.webp'), join(state.dir, 'alias.webp'));
    expect(resolveUploadPath(state.dir, 'alias.webp')).not.toBeNull();
    expect(resolveUploadPath(state.dir, 'brand-new.webp')).toBe(join(state.dir, 'brand-new.webp'));
    mkdirSync(join(state.dir, 'sub'));
    expect(resolveUploadPath(state.dir, 'sub/new/deeper.webp')).not.toBeNull();
  });

  it('works when the uploads dir itself is reached through a symlink', () => {
    const link = join(dir, 'uploads-link');
    symlinkSync(state.dir, link);
    expect(resolveUploadPath(link, 'a.webp')).toBe(join(link, 'a.webp'));
    symlinkSync(outside, join(state.dir, 'out'));
    expect(resolveUploadPath(link, 'out/x')).toBeNull();
  });

  it('a missing uploads dir is not an error', () => {
    expect(resolveUploadPath(join(dir, 'nope'), 'a.webp')).toBe(join(dir, 'nope', 'a.webp'));
  });

  it('GET /api/photos/:id does not serve a symlink escape', async () => {
    const { id } = seedPhoto('evil.webp');
    symlinkSync(join(outside, 'secret.txt'), join(state.dir, 'evil.webp'));
    const res = await GET(new Request('http://localhost:3100/api/photos/x'), ctx(id));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('SECRET');
    expect(state.reads).toEqual([]);
  });
});

describe('GET /api/photos/:id with traversal-looking ids and stored paths', () => {
  it.each(HOSTILE.filter((n) => n !== ''))('id %j: 404 and nothing read', async (id) => {
    const res = await GET(new Request('http://localhost:3100/api/photos/x'), ctx(id));
    expect(res.status).toBe(404);
    expect(state.reads).toEqual([]);
  });

  it.each(['../../etc/passwd', '/etc/passwd', 'a\0b', '..'])(
    'a stored path %j is 404 and nothing is read',
    async (stored) => {
      const { id } = seedPhoto('ok.webp');
      db.update(photo).set({ filePath: stored }).run();
      const res = await GET(new Request('http://localhost:3100/api/photos/x'), ctx(id));
      expect(res.status).toBe(404);
      expect(state.reads).toEqual([]);
    },
  );

  it('control: a normal photo is served and read exactly once', async () => {
    const { id } = seedPhoto('ok.webp');
    const res = await GET(new Request('http://localhost:3100/api/photos/x'), ctx(id));
    expect(res.status).toBe(200);
    expect(state.reads).toHaveLength(1);
  });
});

describe('zip entry-name rule (R12) against the same list', () => {
  it.each(HOSTILE)('refuses %j', (name) => {
    expect(isAllowedEntryName(name)).toBe(false);
  });

  it('refuses traversal around an otherwise valid name', () => {
    const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    for (const n of [
      `../photos/${ulid}.webp`,
      `photos/../photos/${ulid}.webp`,
      `photos/${ulid}.webp/../../x`,
      `/photos/${ulid}.webp`,
      `photos\\${ulid}.webp`,
      `photos/${ulid}.webp\0`,
      `photos/%2e%2e/${ulid}.webp`,
      `photos/${ulid}.webp/`,
      `photos//${ulid}.webp`,
      `Photos/${ulid}.webp`,
    ])
      expect(isAllowedEntryName(n), n).toBe(false);
  });

  it('accepts exactly the manifest and photos/<ulid>.webp', () => {
    expect(isAllowedEntryName('backup.json')).toBe(true);
    expect(isAllowedEntryName('photos/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp')).toBe(true);
  });
});

// Writing is covered by the lexical and symlink cases above: no test here creates a file
// outside the temp uploads dir, and this guard asserts the temp tree stayed clean.
describe('nothing is written outside the uploads dir', () => {
  it('the temp tree only holds what the tests put there', () => {
    resolveUploadPath(state.dir, '../planted');
    expect(readdirSync(dir)).toEqual(['uploads']);
    expect(() => readFileSync(join(dir, 'planted'))).toThrow();
  });
});

// --- helpers (hoisted function declarations) ---
let db: Db;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function seedPhoto(file: string): { id: string } {
  const owner = db.select().from(user).get()!;
  const rid = createRecipe(db, owner.id, {
    fields: { title: 'R', visibility: 'private', viewMode: 'list' },
    sections: [{ title: null, ingredients: [], steps: [] }],
  });
  if (file === 'ok.webp') writeFileSync(join(state.dir, file), 'webpbytes');
  return { id: insertCoverPhoto(db, rid, { filePath: file, width: 1, height: 1 }).id };
}
beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  state.db = db;
  const u = db
    .insert(user)
    .values({ email: 'a@x.test', displayName: 'a', passwordHash: 'h', role: 'member' })
    .returning()
    .get();
  state.current = u;
});
afterEach(() => db.$client.close());
