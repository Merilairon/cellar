import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/connection';
import { note, photo, rating, recipe, user } from '@/lib/db/schema';
import { buildBackup } from './export';
import { applyRestore, previewRestore, renamedTitle, RestoreForbiddenError } from './restore';
import { normalizeDoc, viaJson, webp } from './restore-test-util';
import type { BackupV1 } from './schema';
import {
  addNote,
  addRating,
  maximalRecipe,
  memDb,
  mkUser,
  saveInput,
  setShareToken,
  SAMPLE_INPUTS,
  type U,
} from './test-fixtures';
import { openZip } from './unzip';
import { rawZip } from './unzip-test-util';

const dbs: Db[] = [];
const fresh = () => {
  const d = memDb();
  dbs.push(d);
  return d;
};
let uploads: string;
beforeEach(() => {
  uploads = mkdtempSync(join(tmpdir(), 'restore-uploads-'));
});
afterEach(() => {
  while (dbs.length) dbs.pop()!.$client.close();
  rmSync(uploads, { recursive: true, force: true });
});

const rows = (db: Db) => ({
  recipes: db.select({ n: count() }).from(recipe).get()!.n,
  notes: db.select({ n: count() }).from(note).get()!.n,
  ratings: db.select({ n: count() }).from(rating).get()!.n,
  photos: db.select({ n: count() }).from(photo).get()!.n,
  users: db.select({ n: count() }).from(user).get()!.n,
});
const titles = (db: Db, owner: string) =>
  db
    .select({ t: recipe.title })
    .from(recipe)
    .where(eq(recipe.ownerId, owner))
    .all()
    .map((r) => r.t)
    .sort();

/** Source instance: ann (member) with notes/ratings from bob, plus an admin. */
function source() {
  const db = fresh();
  const admin = mkUser(db, 'admin@x.test', 'admin');
  const ann = mkUser(db, 'ann@x.test');
  const bob = mkUser(db, 'bob@x.test');
  const r1 = saveInput(db, ann.id, {
    ...SAMPLE_INPUTS[0],
    title: 'Ann cookies',
    visibility: 'users',
  });
  const r2 = saveInput(db, ann.id, { ...SAMPLE_INPUTS[1], title: 'Ann cake' });
  const r3 = saveInput(db, bob.id, { ...SAMPLE_INPUTS[0], title: 'Bob soup', visibility: 'users' });
  addNote(db, r1, ann.id, 'my private note', false);
  addNote(db, r1, ann.id, 'my shared note', true);
  addNote(db, r1, bob.id, 'bob shared note', true);
  addNote(db, r1, bob.id, 'bob private note', false);
  addRating(db, r1, ann.id, 4);
  addRating(db, r1, bob.id, 2);
  addNote(db, r3, bob.id, 'bob on his soup', true);
  addRating(db, r3, ann.id, 5);
  setShareToken(db, r1, 'SECRET-TOKEN-1');
  return { db, admin, ann, bob, r1, r2, r3 };
}

const ownDoc = (w: ReturnType<typeof source>) => viaJson(buildBackup(w.db, w.ann, { all: false }));
const allDoc = (w: ReturnType<typeof source>) => viaJson(buildBackup(w.db, w.admin, { all: true }));

function target() {
  const db = fresh();
  const admin = mkUser(db, 'admin@x.test', 'admin');
  const member = mkUser(db, 'new@x.test');
  return { db, admin, member };
}

const apply = (
  db: Db,
  actor: U,
  doc: BackupV1,
  strategy: 'skip' | 'rename' = 'skip',
  photos: Parameters<typeof applyRestore>[3] = null,
) => applyRestore(db, actor, doc, photos, strategy, uploads);

describe('previewRestore', () => {
  it('counts a member restore and makes no writes', () => {
    const doc = ownDoc(source());
    const t = target();
    const before = rows(t.db);
    const p = previewRestore(t.db, t.member, doc, null);
    expect(rows(t.db)).toEqual(before);
    expect(p).toMatchObject({
      scope: 'own',
      recipes: 2,
      notes: 2, // only ann's own two notes belong to the caller
      notes_skipped: 1, // bob's shared note
      ratings: 1,
      ratings_skipped: 0,
      photos: 0,
      conflicts: [],
      unknown_users: [],
    });
    expect(p.sections).toBe(doc.recipes.reduce((n, r) => n + r.sections.length, 0));
    expect(p.ingredients).toBeGreaterThan(0);
  });

  it('lists conflicts by normalized title: trim, NFC, case-fold', () => {
    const doc = ownDoc(source());
    const t = target();
    // "cafe" with a combining accent, upper case, padded: same title after normalization.
    saveInput(t.db, t.member.id, { ...SAMPLE_INPUTS[0], title: '  ANN COOKIES ' });
    const p = previewRestore(t.db, t.member, doc, null);
    expect(p.conflicts).toEqual([{ title: 'Ann cookies', reason: 'same_title' }]);
  });

  it('NFC: a decomposed title conflicts with its composed spelling', () => {
    const doc = ownDoc(source());
    doc.recipes[0]!.title = 'Crème brûlée'; // decomposed
    const t = target();
    saveInput(t.db, t.member.id, { ...SAMPLE_INPUTS[0], title: 'Crème brûlée'.normalize('NFC') });
    expect(previewRestore(t.db, t.member, doc, null).conflicts).toHaveLength(1);
  });

  it('another owner with the same title is not a conflict', () => {
    const doc = ownDoc(source());
    const t = target();
    saveInput(t.db, t.admin.id, { ...SAMPLE_INPUTS[0], title: 'Ann cookies' });
    expect(previewRestore(t.db, t.member, doc, null).conflicts).toEqual([]);
  });

  it('a member cannot preview or apply a scope all document', async () => {
    const doc = allDoc(source());
    const t = target();
    expect(() => previewRestore(t.db, t.member, doc, null)).toThrow(RestoreForbiddenError);
    await expect(apply(t.db, t.member, doc)).rejects.toBeInstanceOf(RestoreForbiddenError);
    expect(rows(t.db).recipes).toBe(0);
  });

  it('counts only photo files present in the archive', async () => {
    const w = source();
    const doc = ownDoc(w);
    doc.recipes[0]!.photos = [
      {
        position: 0,
        is_cover: true,
        width: 1,
        height: 1,
        file: 'photos/01HZX0000000000000000000AB.webp',
        thumb: null,
      },
    ];
    const t = target();
    expect(previewRestore(t.db, t.member, doc, { has: () => true }).photos).toBe(1);
    expect(previewRestore(t.db, t.member, doc, { has: () => false }).photos).toBe(0);
    expect(previewRestore(t.db, t.member, doc, null).photos).toBe(0);
  });
});

describe('applyRestore: member', () => {
  it('imports as the caller: own notes and rating, not others; stamps new; no share token', async () => {
    const w = source();
    const doc = ownDoc(w);
    const t = target();
    const res = await apply(t.db, t.member, doc);
    expect(res).toEqual({
      imported: 2,
      skipped: 0,
      renamed: 0,
      notes_restored: 2,
      notes_skipped: 1,
      ratings_restored: 1,
      ratings_skipped: 0,
      photos_restored: 0,
      photos_failed: 0,
      failed_at: null,
    });
    const mine = t.db.select().from(recipe).all();
    expect(mine.every((r) => r.ownerId === t.member.id)).toBe(true);
    expect(mine.every((r) => r.shareToken === null)).toBe(true);
    expect(mine.find((r) => r.title === 'Ann cookies')!.visibility).toBe('users');
    expect(mine.every((r) => r.createdAt > '2026-01-01')).toBe(true);
    const notes = t.db.select().from(note).all();
    expect(notes.map((n) => n.body).sort()).toEqual(['my private note', 'my shared note']);
    expect(notes.every((n) => n.userId === t.member.id)).toBe(true);
    expect(notes.find((n) => n.body === 'my shared note')!.shared).toBe(true);
    const ratings = t.db.select().from(rating).all();
    expect(ratings).toHaveLength(1);
    expect(ratings[0]).toMatchObject({ userId: t.member.id, stars: 4 });
    // Nothing from the file made it into other accounts.
    expect(rows(t.db).users).toBe(2);
  });

  it('the restored notes keep their file order', async () => {
    const w = source();
    for (let i = 0; i < 30; i++)
      addNote(w.db, w.r2, w.ann.id, `n${String(i).padStart(2, '0')}`, i % 2 === 0);
    const t = target();
    const doc = ownDoc(w);
    await apply(t.db, t.member, doc);
    const back = viaJson(buildBackup(t.db, t.member, { all: false }));
    const bodies = back.recipes.find((r) => r.title === 'Ann cake')!.notes.map((n) => n.body);
    expect(bodies).toEqual(
      doc.recipes.find((r) => r.title === 'Ann cake')!.notes.map((n) => n.body),
    );
    expect(bodies).toHaveLength(30);
  });

  it('never takes the owner from the file: a forged owner_email in an own document is rejected earlier, and users[].role is never read', async () => {
    const w = source();
    const doc = allDoc(w);
    doc.users!.find((u) => u.email === 'bob@x.test')!.role = 'admin';
    const t = target();
    await apply(t.db, t.admin, doc);
    expect(
      t.db
        .select()
        .from(user)
        .all()
        .map((u) => [u.email, u.role])
        .sort(),
    ).toEqual([
      ['admin@x.test', 'admin'],
      ['new@x.test', 'member'],
    ]);
  });

  it('skip leaves conflicting titles out and counts them', async () => {
    const doc = ownDoc(source());
    const t = target();
    saveInput(t.db, t.member.id, { ...SAMPLE_INPUTS[0], title: 'ann COOKIES' });
    const res = await apply(t.db, t.member, doc, 'skip');
    expect(res).toMatchObject({ imported: 1, skipped: 1, renamed: 0 });
    expect(titles(t.db, t.member.id)).toEqual(['Ann cake', 'ann COOKIES']);
    expect(rows(t.db).notes).toBe(0); // the skipped recipe brought no notes
  });

  it('rename imports as Title (restored), then (restored 2), (restored 3)', async () => {
    const doc = ownDoc(source());
    const t = target();
    saveInput(t.db, t.member.id, { ...SAMPLE_INPUTS[0], title: 'Ann cookies' });
    const r1 = await apply(t.db, t.member, doc, 'rename');
    expect(r1).toMatchObject({ imported: 2, renamed: 1, skipped: 0 });
    const r2 = await apply(t.db, t.member, doc, 'rename');
    expect(r2).toMatchObject({ imported: 2, renamed: 2 }); // both exist now
    const r3 = await apply(t.db, t.member, doc, 'rename');
    expect(r3.renamed).toBe(2);
    expect(titles(t.db, t.member.id)).toEqual(
      [
        'Ann cake',
        'Ann cake (restored)',
        'Ann cake (restored 2)',
        'Ann cookies',
        'Ann cookies (restored)',
        'Ann cookies (restored 2)',
        'Ann cookies (restored 3)',
      ].sort(),
    );
  });

  it('a long title is cut so the renamed title still fits 200 characters', () => {
    const long = 'x'.repeat(200);
    const out = renamedTitle(long, new Set());
    expect([...out]).toHaveLength(200);
    expect(out.endsWith(' (restored)')).toBe(true);
  });

  it('restoring twice with skip imports nothing the second time', async () => {
    const doc = ownDoc(source());
    const t = target();
    await apply(t.db, t.member, doc);
    const again = await apply(t.db, t.member, doc);
    expect(again).toMatchObject({ imported: 0, skipped: 2, failed_at: null });
    expect(rows(t.db).recipes).toBe(2);
  });

  it('two recipes with one title inside the file are restored as they were', async () => {
    const w = source();
    saveInput(w.db, w.ann.id, { ...SAMPLE_INPUTS[0], title: 'Ann cake' });
    const t = target();
    const res = await apply(t.db, t.member, ownDoc(w));
    expect(res).toMatchObject({ imported: 3, renamed: 0, skipped: 0 });
  });

  it('a failure at recipe k keeps 0..k-1 and reports k', async () => {
    const doc = ownDoc(source());
    // Recipe 1 is a grid whose span points outside its rows: validateRecipeGrid refuses it.
    const bad = doc.recipes[1]!;
    bad.view_mode = 'grid';
    const col = bad.sections[0]!.steps.find((s) => s.kind === 'column');
    if (col) {
      col.row_start = 0;
      col.row_end = 999;
    } else {
      bad.sections[0]!.steps.push({
        position: bad.sections[0]!.steps.length,
        kind: 'column',
        label: 'x',
        detail: '',
        row_start: 0,
        row_end: 999,
        temp_c: null,
        temp_f: null,
        minutes_min: null,
        minutes_max: null,
      });
    }
    doc.recipes.push({ ...doc.recipes[0]!, title: 'After the failure' });
    const t = target();
    const res = await apply(t.db, t.member, doc);
    expect(res).toMatchObject({ imported: 1, failed_at: 1 });
    expect(titles(t.db, t.member.id)).toEqual([doc.recipes[0]!.title]);
  });

  it('a list-mode recipe with spanless column steps is not a validation failure', async () => {
    const doc = ownDoc(source());
    const r = doc.recipes[0]!;
    r.view_mode = 'list';
    r.sections[0]!.steps.forEach((s) => {
      if (s.kind === 'column') {
        s.row_start = null;
        s.row_end = null;
      }
    });
    const t = target();
    expect(await apply(t.db, t.member, doc)).toMatchObject({ imported: 2, failed_at: null });
  });

  it('a database failure inside the recipe transaction rolls that recipe back whole', async () => {
    const doc = ownDoc(source());
    // Force the note insert to fail: a body that violates the CHECK is impossible through the
    // schema, so break the transaction with a trigger instead.
    const t = target();
    t.db.$client.exec(
      "create trigger boom before insert on rating begin select raise(abort, 'boom'); end",
    );
    const res = await apply(t.db, t.member, doc);
    expect(res.failed_at).toBe(0); // recipe 0 has a rating
    expect(rows(t.db)).toMatchObject({ recipes: 0, notes: 0, ratings: 0 });
    expect(t.db.$client.prepare('select count(*) n from recipe_fts').get()).toEqual({ n: 0 });
  });
});

describe('applyRestore: admin, scope all', () => {
  function adminTarget() {
    const db = fresh();
    const admin = mkUser(db, 'admin@x.test', 'admin');
    const ann = mkUser(db, 'ann@x.test');
    return { db, admin, ann };
  }

  it('maps owners, notes and ratings by email; unknown owners go to the admin; no users created', async () => {
    const doc = allDoc(source());
    const t = adminTarget(); // bob does not exist here
    const p = previewRestore(t.db, t.admin, doc, null);
    expect(p).toMatchObject({
      scope: 'all',
      recipes: 3,
      unknown_users: ['bob@x.test'],
      notes: 2,
      notes_skipped: 3,
      ratings: 3 - 1,
      ratings_skipped: 1,
    });
    const before = rows(t.db);
    const res = await apply(t.db, t.admin, doc);
    expect(res).toMatchObject({
      imported: 3,
      notes_restored: 2,
      notes_skipped: 3,
      ratings_restored: 2,
      ratings_skipped: 1,
      failed_at: null,
    });
    expect(rows(t.db).users).toBe(before.users);
    expect(titles(t.db, t.ann.id)).toEqual(['Ann cake', 'Ann cookies']);
    expect(titles(t.db, t.admin.id)).toEqual(['Bob soup']);
    expect(
      t.db
        .select()
        .from(note)
        .all()
        .map((n) => n.userId),
    ).toEqual([t.ann.id, t.ann.id]);
    expect(
      t.db
        .select()
        .from(rating)
        .all()
        .every((x) => x.userId === t.ann.id),
    ).toBe(true);
  });

  it('a deactivated account is not a target: its recipes go to the admin', async () => {
    const doc = allDoc(source());
    const t = adminTarget();
    t.db
      .update(user)
      .set({ deactivatedAt: '2026-01-01T00:00:00.000Z' })
      .where(eq(user.id, t.ann.id))
      .run();
    const p = previewRestore(t.db, t.admin, doc, null);
    expect(p.unknown_users).toEqual(['ann@x.test', 'bob@x.test']);
    await apply(t.db, t.admin, doc);
    expect(titles(t.db, t.ann.id)).toEqual([]);
    expect(rows(t.db).recipes).toBe(3);
  });

  it('conflicts are per target owner; rename and skip work as for a member', async () => {
    const doc = allDoc(source());
    const t = adminTarget();
    saveInput(t.db, t.ann.id, { ...SAMPLE_INPUTS[0], title: 'ann cookies' });
    saveInput(t.db, t.ann.id, { ...SAMPLE_INPUTS[0], title: 'Bob soup' }); // ann's, not the admin's
    expect(previewRestore(t.db, t.admin, doc, null).conflicts).toEqual([
      { title: 'Ann cookies', reason: 'same_title' },
    ]);
    const res = await apply(t.db, t.admin, doc, 'rename');
    expect(res).toMatchObject({ imported: 3, renamed: 1 });
    expect(titles(t.db, t.ann.id)).toContain('Ann cookies (restored)');
    expect(titles(t.db, t.admin.id)).toEqual(['Bob soup']);
  });

  it('an admin restoring an own-scope document restores into their own book like a member', async () => {
    const doc = ownDoc(source());
    const t = adminTarget();
    const res = await apply(t.db, t.admin, doc);
    expect(res).toMatchObject({
      imported: 2,
      notes_restored: 2,
      notes_skipped: 1,
      ratings_restored: 1,
    });
    expect(titles(t.db, t.admin.id)).toHaveLength(2);
  });
});

describe('applyRestore: photos', () => {
  async function photoDoc() {
    const w = source();
    const doc = ownDoc(w);
    const good1 = await webp(64, 48);
    const good2 = await webp(32, 32, '#2980b9');
    const names = [
      'photos/01HZX0000000000000000000A1.webp',
      'photos/01HZX0000000000000000000A2.webp',
      'photos/01HZX0000000000000000000A3.webp',
      'photos/01HZX0000000000000000000A4.webp',
    ];
    const ph = (i: number, cover: boolean) => ({
      position: i,
      is_cover: cover,
      width: 1,
      height: 1,
      file: names[i]!,
      thumb: null,
    });
    doc.recipes[0]!.photos = [ph(0, false), ph(1, true), ph(2, false)];
    doc.recipes[1]!.photos = [ph(3, true)];
    const zipPath = join(uploads, '..', `photos-${Date.now()}-${Math.random()}.zip`);
    writeFileSync(
      zipPath,
      rawZip([
        { name: names[0]!, data: good1 },
        { name: names[1]!, data: good2, method: 8 },
        { name: names[2]!, data: Buffer.from('not an image at all') },
        // names[3] is referenced but absent from the archive
      ]),
    );
    return { doc, zipPath };
  }

  it('re-encodes each photo with fresh names, keeps the cover; a bad or missing one is counted', async () => {
    const { doc, zipPath } = await photoDoc();
    const zip = await openZip(zipPath);
    const t = target();
    const pre = previewRestore(t.db, t.member, doc, zip);
    expect(pre.photos).toBe(3);
    const res = await apply(t.db, t.member, doc, 'skip', zip);
    await zip.close();
    rmSync(zipPath);
    expect(res).toMatchObject({
      imported: 2,
      photos_restored: 2,
      photos_failed: 2,
      failed_at: null,
    });
    const files = readdirSync(uploads).sort();
    expect(files).toHaveLength(4); // main + thumb per restored photo, nothing for the failures
    const stored = t.db.select().from(photo).all();
    expect(stored).toHaveLength(2);
    for (const p of stored) {
      expect(files).toContain(p.filePath);
      expect(files).toContain(p.thumbPath);
      expect(p.filePath).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}\.webp$/);
      expect(p.filePath).not.toContain('01HZX');
    }
    const cookies = t.db.select().from(recipe).where(eq(recipe.title, 'Ann cookies')).get()!;
    const mine = stored.filter((p) => p.recipeId === cookies.id);
    expect(mine).toHaveLength(2);
    expect(mine.map((p) => [p.position, p.isCover]).sort()).toEqual([
      [0, false],
      [1, true],
    ]);
    // The recipes themselves stayed committed.
    expect(rows(t.db).recipes).toBe(2);
  });

  it('when the cover photo is the bad one, another photo becomes the cover', async () => {
    const { doc, zipPath } = await photoDoc();
    doc.recipes[0]!.photos[1]!.file = 'photos/01HZX0000000000000000000A3.webp'; // the garbage entry
    doc.recipes[0]!.photos[2]!.file = 'photos/01HZX0000000000000000000A2.webp';
    const zip = await openZip(zipPath);
    const t = target();
    await apply(t.db, t.member, doc, 'skip', zip);
    await zip.close();
    const cookies = t.db.select().from(recipe).where(eq(recipe.title, 'Ann cookies')).get()!;
    const mine = t.db.select().from(photo).where(eq(photo.recipeId, cookies.id)).all();
    expect(mine.filter((p) => p.isCover)).toHaveLength(1);
  });

  it("a failing photo row insert removes that photo's files and counts a failure", async () => {
    const { doc, zipPath } = await photoDoc();
    const zip = await openZip(zipPath);
    const t = target();
    const res = await applyRestore(t.db, t.member, doc, zip, 'skip', uploads, {
      insertPhotoRow: () => {
        throw new Error('disk full');
      },
    });
    await zip.close();
    expect(res).toMatchObject({
      photos_restored: 0,
      photos_failed: 4,
      imported: 2,
      failed_at: null,
    });
    expect(readdirSync(uploads)).toEqual([]);
    expect(rows(t.db).photos).toBe(0);
  });

  it('retries a busy decode limiter, then counts the photo as failed', async () => {
    const { LimiterBusyError } = await import('@/lib/import/limiter');
    const { doc, zipPath } = await photoDoc();
    const zip = await openZip(zipPath);
    const t = target();
    let calls = 0;
    const res = await applyRestore(t.db, t.member, doc, zip, 'skip', uploads, {
      decode: async () => {
        calls++;
        throw new LimiterBusyError(1);
      },
      sleep: async () => undefined,
    });
    await zip.close();
    expect(res.photos_restored).toBe(0);
    expect(calls).toBe(3 * 4); // 3 photos present in the archive, 1 try + 3 retries each
  });

  it('a JSON backup (no archive) restores no photo and counts none as failed', async () => {
    const { doc } = await photoDoc();
    const t = target();
    const res = await apply(t.db, t.member, doc, 'skip', null);
    expect(res).toMatchObject({ imported: 2, photos_restored: 0, photos_failed: 0 });
    expect(previewRestore(t.db, t.member, doc, null).photos).toBe(0);
    expect(readdirSync(uploads)).toEqual([]);
  });
});

describe('round trip at the restore level', () => {
  const cases: Array<[string, () => Parameters<typeof saveInput>[2]]> = [
    ['sample: skillet cookie', () => SAMPLE_INPUTS[0]],
    ['sample: vanilla cake', () => SAMPLE_INPUTS[1]],
    ['maximal 20-section recipe', maximalRecipe],
  ];
  it.each(cases)('%s: buildBackup(B) equals buildBackup(A) modulo stamps', async (_n, input) => {
    const a = fresh();
    const ua = mkUser(a, 'a@x.test');
    const ub = mkUser(a, 'b@x.test');
    const id = saveInput(a, ua.id, input());
    addNote(a, id, ua.id, 'mine', false);
    addNote(a, id, ub.id, 'theirs shared', true);
    addRating(a, id, ua.id, 5);
    const first = viaJson(buildBackup(a, ua, { all: false }));
    const b = fresh();
    const uc = mkUser(b, 'c@x.test');
    await apply(b, uc, first);
    const second = viaJson(buildBackup(b, uc, { all: false }));
    // The other user's shared note stays with the exporter: dropped on restore, by contract.
    const expected = normalizeDoc(first);
    // and the author of an own note is now the restoring user.
    expected.recipes[0]!.notes = expected.recipes[0]!.notes.filter((n) => n.mine === true).map(
      (n) => ({ ...n, author_display_name: uc.displayName }),
    );
    expect(normalizeDoc(second)).toEqual(expected);
  });
});
