import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './connection';
import { confinedRawHtmlPath, pruneImportJobs } from './import-jobs';
import { runMigrations } from './migrate';
import { importJob, photo, recipe, user } from './schema';

let db: Db;
let dir: string;
const NOW = new Date('2026-06-01T00:00:00.000Z');
const OLD = '2026-03-01T00:00:00.000Z'; // 92 days before NOW
const FRESH = '2026-05-25T00:00:00.000Z';
let n = 0;
const ulid26 = () => `01JTESTJOB${String(++n).padStart(16, '0')}`;

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  dir = mkdtempSync(join(tmpdir(), 'prune-'));
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const mkUser = () =>
  db
    .insert(user)
    .values({ email: `u${++n}@x.test`, displayName: 'u', passwordHash: 'h', role: 'member' })
    .returning()
    .get();

function mkJob(
  userId: string,
  status: (typeof importJob.$inferInsert)['status'],
  updatedAt: string,
  extra: Partial<typeof importJob.$inferInsert> = {},
  withFile = true,
) {
  const id = ulid26();
  const path = join(dir, `${id}.html`);
  if (withFile) writeFileSync(path, '<html/>');
  db.insert(importJob)
    .values({
      id,
      userId,
      status,
      draftJson: '{"v":1}',
      rawHtmlPath: path,
      createdAt: updatedAt,
      updatedAt,
      ...extra,
    })
    .run();
  return { id, path };
}
const row = (id: string) => db.select().from(importJob).where(eq(importJob.id, id)).get();
const prune = (days = 30, extra = {}) =>
  pruneImportJobs(db, { olderThanDays: days, now: NOW, rawHtmlDir: dir, ...extra });

describe('pruneImportJobs', () => {
  it('deletes old failed/needs_review/parsed rows and files, keeps fresh and active ones', () => {
    const u = mkUser();
    const old = (['failed', 'needs_review', 'parsed'] as const).map((s) => mkJob(u.id, s, OLD));
    const fresh = mkJob(u.id, 'needs_review', FRESH);
    const fetching = mkJob(u.id, 'fetching', OLD);
    const queued = mkJob(u.id, 'queued', OLD);
    const res = prune();
    expect(res).toEqual({ deleted: 3, trimmed: 0, filesRemoved: 3 });
    for (const j of old) {
      expect(row(j.id)).toBeUndefined();
      expect(existsSync(j.path)).toBe(false);
    }
    for (const j of [fresh, fetching, queued]) {
      expect(row(j.id)).toBeDefined();
      expect(existsSync(j.path)).toBe(true);
    }
  });

  it('trims old saved jobs but keeps row, recipe link, recipe and photos', () => {
    const u = mkUser();
    const r = db
      .insert(recipe)
      .values({ ownerId: u.id, title: 'R', sourceUrl: 'https://a.test/' })
      .returning()
      .get();
    db.insert(photo).values({ recipeId: r.id, filePath: 'p.webp', width: 1, height: 1 }).run();
    const j = mkJob(u.id, 'saved', OLD, { recipeId: r.id, url: 'https://a.test/' });
    expect(prune()).toEqual({ deleted: 0, trimmed: 1, filesRemoved: 1 });
    const after = row(j.id)!;
    expect(after.status).toBe('saved');
    expect(after.recipeId).toBe(r.id);
    expect(after.url).toBe('https://a.test/');
    expect(after.draftJson).toBeNull();
    expect(after.rawHtmlPath).toBeNull();
    expect(existsSync(j.path)).toBe(false);
    expect(db.select().from(recipe).all()).toHaveLength(1);
    expect(db.select().from(photo).all()).toHaveLength(1);
    expect(db.select().from(recipe).get()!.sourceUrl).toBe('https://a.test/');
  });

  it('is idempotent, tolerates missing files', () => {
    const u = mkUser();
    mkJob(u.id, 'failed', OLD, {}, false);
    mkJob(u.id, 'saved', OLD);
    expect(prune()).toEqual({ deleted: 1, trimmed: 1, filesRemoved: 1 });
    expect(prune()).toEqual({ deleted: 0, trimmed: 0, filesRemoved: 0 });
  });

  it('is a no-op when the TTL is 0', () => {
    const u = mkUser();
    const j = mkJob(u.id, 'failed', OLD);
    expect(prune(0)).toEqual({ deleted: 0, trimmed: 0, filesRemoved: 0 });
    expect(row(j.id)).toBeDefined();
    expect(existsSync(j.path)).toBe(true);
  });

  it('honours the batch limit', () => {
    const u = mkUser();
    for (let i = 0; i < 5; i++) mkJob(u.id, 'failed', OLD);
    expect(prune(30, { limit: 2 }).deleted).toBe(2);
    expect(prune(30, { limit: 100 }).deleted).toBe(3);
  });

  it('never unlinks files outside RAW_HTML_DIR or with foreign names (traversal)', () => {
    const u = mkUser();
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    const victim = join(outside, `${'A'.repeat(26)}.html`);
    writeFileSync(victim, 'keep');
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const nested = join(sub, `${'B'.repeat(26)}.html`);
    writeFileSync(nested, 'keep');
    const named = join(dir, 'notes.html');
    writeFileSync(named, 'keep');
    const bad = [
      victim,
      nested,
      named,
      join(dir, '..', `${'A'.repeat(26)}.html`),
      `${dir}/../${outside.split('/').pop()}/${'A'.repeat(26)}.html`,
    ].map((p) => mkJob(u.id, 'failed', OLD, { rawHtmlPath: p }, false));
    const res = prune();
    expect(res.deleted).toBe(bad.length);
    expect(res.filesRemoved).toBe(0);
    for (const p of [victim, nested, named]) expect(existsSync(p)).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });

  it('skips a row changed between the SELECT and the write (CAS)', () => {
    const u = mkUser();
    const j = mkJob(u.id, 'needs_review', OLD);
    // A concurrent save lands after the row was selected as prunable.
    const res = prune(30, {
      afterSelect: () =>
        db
          .update(importJob)
          .set({ status: 'saved', updatedAt: FRESH })
          .where(eq(importJob.id, j.id))
          .run(),
    });
    expect(res).toEqual({ deleted: 0, trimmed: 0, filesRemoved: 0 });
    expect(row(j.id)).toMatchObject({ status: 'saved' });
    expect(row(j.id)!.draftJson).not.toBeNull();
    expect(existsSync(j.path)).toBe(true);
  });

  it('unlinks files in an extra (legacy) raw dir and still confines them', () => {
    const u = mkUser();
    const legacy = mkdtempSync(join(tmpdir(), 'legacy-'));
    const id = ulid26();
    const p = join(legacy, `${id}.html`);
    writeFileSync(p, '<html/>');
    mkJob(u.id, 'failed', OLD, { id, rawHtmlPath: p }, false);
    const outsider = mkJob(u.id, 'failed', OLD, {}, true);
    expect(prune(30, { extraRawHtmlDirs: [legacy] }).filesRemoved).toBe(2);
    expect(existsSync(p)).toBe(false);
    expect(existsSync(outsider.path)).toBe(false);
    expect(prune(30, { extraRawHtmlDirs: [legacy] }).filesRemoved).toBe(0);
    rmSync(legacy, { recursive: true, force: true });
  });
});

describe('confinedRawHtmlPath', () => {
  it('accepts only <dir>/<26 chars>.html', () => {
    const ok = join(dir, `${'C'.repeat(26)}.html`);
    expect(confinedRawHtmlPath(dir, ok)).toBe(ok);
    expect(confinedRawHtmlPath(dir, null)).toBeNull();
    expect(confinedRawHtmlPath(dir, `${dir}/../x/${'C'.repeat(26)}.html`)).toBeNull();
    expect(confinedRawHtmlPath(dir, `${ok}/..`)).toBeNull();
  });
});
