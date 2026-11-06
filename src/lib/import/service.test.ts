import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { createRecipe } from '@/lib/db/recipes';
import { importJob, recipe, user } from '@/lib/db/schema';
import { ImportError } from './errors';
import { markImportJobSaved } from '@/lib/db/import-jobs';
import { createImport, getImportFor, STALE_FETCHING_MS } from './service';
import type { SafeFetchOptions, SafeFetchResult } from './safe-fetch';

const enc = new TextEncoder();
const RECIPE = {
  '@type': 'Recipe',
  name: 'Pancakes',
  image: 'https://cdn.example.com/p.jpg',
  recipeIngredient: ['2 eggs', '1 cup flour'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Mix.' },
    { '@type': 'HowToStep', text: 'Fry.' },
  ],
};
const page = `<html><script type="application/ld+json">${JSON.stringify(RECIPE)}</script></html>`;
const okFetch = () =>
  vi.fn<(u: string, o?: SafeFetchOptions) => Promise<SafeFetchResult>>(async () => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: enc.encode(page),
    finalUrl: 'https://example.com/p',
  }));

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
const tree = (url: string | null, visibility: 'private' | 'users') => ({
  fields: { title: 'Existing', sourceUrl: url, visibility, viewMode: 'list' as const },
  sections: [{ title: null, ingredients: [], steps: [] }],
});

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  a = mk('a@x.test') as typeof a;
  b = mk('b@x.test') as typeof b;
  dir = mkdtempSync(join(tmpdir(), 'svc-'));
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createImport', () => {
  it('URL import: job goes fetching -> needs_review, method static, draft persisted, no recipe', async () => {
    const f = okFetch();
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p?utm_source=x' },
      { safeFetch: f, fetchOptions: { allowLocal: false } },
    );
    expect(res).toMatchObject({
      status: 'needs_review',
      method: 'static',
      error_code: null,
      duplicate: null,
    });
    // The mapper ran: a proposal exists and the top-level fields mirror it.
    expect(res.confidence).toEqual(expect.any(Number));
    expect(['high', 'medium', 'low']).toContain(res.mapping_level);
    expect((res.draft as { title: string }).title).toBe('Pancakes');
    expect(f.mock.calls[0]![1]).toEqual({ allowLocal: false });
    const job = db.select().from(importJob).get()!;
    expect(job).toMatchObject({
      status: 'needs_review',
      method: 'static',
      url: 'https://example.com/p',
      rawHtmlPath: null,
    });
    expect(db.select().from(recipe).all()).toHaveLength(0);
  });

  it('failed fetch: status failed with a stable code, no draft, no recipe', async () => {
    const f = vi.fn(async () => {
      throw new ImportError('private_address', new Error('resolved 10.0.0.1'));
    });
    const log = vi.fn();
    const res = await createImport(db, a, { url: 'http://10.0.0.1/' }, { safeFetch: f, log });
    expect(res).toMatchObject({ status: 'failed', error_code: 'private_address', draft: null });
    expect(JSON.stringify(res)).not.toContain('10.0.0.1');
    expect(db.select().from(importJob).get()).toMatchObject({
      status: 'failed',
      errorCode: 'private_address',
      draftJson: null,
    });
    expect(db.select().from(recipe).all()).toHaveLength(0);
  });

  it('invalid url is a failed job (invalid_url), not a throw', async () => {
    const f = okFetch();
    const res = await createImport(db, a, { url: 'ftp://x.test/' }, { safeFetch: f });
    expect(res).toMatchObject({ status: 'failed', error_code: 'invalid_url' });
    expect(f).not.toHaveBeenCalled();
  });

  it('paste: no network call, method paste', async () => {
    const f = okFetch();
    const res = await createImport(db, a, { text: page }, { safeFetch: f });
    expect(res).toMatchObject({ status: 'needs_review', method: 'paste' });
    expect(f).not.toHaveBeenCalled();
  });

  it('never exposes raw_html in the response, even when keeping it', async () => {
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: okFetch(), keepRawHtml: true, rawHtmlDir: join(dir, 'import-raw') },
    );
    const s = JSON.stringify(res);
    expect(s).not.toMatch(/raw_html|rawHtml|ld\+json/);
    expect(JSON.stringify(getImportFor(db, a, res.id))).not.toMatch(/raw_html|rawHtml|ld\+json/);
  });

  it('KEEP_RAW_HTML off: no file, null column', async () => {
    await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: okFetch(), keepRawHtml: false, rawHtmlDir: join(dir, 'import-raw') },
    );
    expect(db.select().from(importJob).get()!.rawHtmlPath).toBeNull();
    expect(existsSync(join(dir, 'import-raw'))).toBe(false);
  });

  it('KEEP_RAW_HTML on: file 0600 named from job id, outside uploads, path stored', async () => {
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: okFetch(), keepRawHtml: true, rawHtmlDir: join(dir, 'import-raw') },
    );
    const path = db.select().from(importJob).get()!.rawHtmlPath!;
    expect(path).toBe(join(dir, 'import-raw', `${res.id}.html`));
    expect(path.startsWith(join(dir, 'uploads'))).toBe(false);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf8')).toContain('Pancakes');
  });

  it('limits concurrent fetches to 4', async () => {
    let active = 0;
    let peak = 0;
    const f = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: enc.encode(page),
        finalUrl: 'https://example.com/p',
      };
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createImport(db, a, { url: `https://example.com/${i}` }, { safeFetch: f }),
      ),
    );
    expect(peak).toBe(4);
  });

  describe('duplicate detection', () => {
    it("detects the same URL with tracking params in the caller's own recipe", async () => {
      const id = createRecipe(db, a.id, tree('https://example.com/p', 'private'));
      const res = await createImport(
        db,
        a,
        { url: 'http://example.com/p/?utm_campaign=z#x' },
        { safeFetch: okFetch() },
      );
      expect(res.duplicate).toEqual({ recipe_id: id, title: 'Existing' });
    });
    it('matches a recipe stored with http when the import URL is https, and the reverse (Q3)', async () => {
      const id = createRecipe(db, a.id, tree('http://example.com/p', 'private'));
      const res = await createImport(
        db,
        a,
        { url: 'https://example.com/p' },
        { safeFetch: okFetch() },
      );
      expect(res.duplicate?.recipe_id).toBe(id);
      const res2 = await createImport(
        db,
        a,
        { url: 'http://example.com/p' },
        { safeFetch: okFetch() },
      );
      expect(res2.duplicate?.recipe_id).toBe(id);
    });
    it('does not match a different path', async () => {
      createRecipe(db, a.id, tree('http://example.com/other', 'private'));
      const res = await createImport(
        db,
        a,
        { url: 'https://example.com/p' },
        { safeFetch: okFetch() },
      );
      expect(res.duplicate).toBeNull();
    });
    it("never reveals another user's private recipe", async () => {
      createRecipe(db, b.id, tree('https://example.com/p', 'private'));
      const res = await createImport(
        db,
        a,
        { url: 'https://example.com/p' },
        { safeFetch: okFetch() },
      );
      expect(res.duplicate).toBeNull();
    });
    it('shows a users-visible recipe of another user', async () => {
      const id = createRecipe(db, b.id, tree('https://example.com/p', 'users'));
      const res = await createImport(
        db,
        a,
        { url: 'https://example.com/p' },
        { safeFetch: okFetch() },
      );
      expect(res.duplicate?.recipe_id).toBe(id);
    });
  });
});

describe('getImportFor', () => {
  it('returns the job to its owner and null to anyone else', async () => {
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: okFetch() },
    );
    expect(getImportFor(db, a, res.id)).toMatchObject({ id: res.id, status: 'needs_review' });
    expect(getImportFor(db, b, res.id)).toBeNull();
    expect(getImportFor(db, a, 'nope')).toBeNull();
  });
});

describe('mapping in the response (G21, G23)', () => {
  it('exposes confidence and level from the stored proposal, rounded to 2 decimals', async () => {
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: okFetch() },
    );
    const draft = res.draft as { mapping: { confidence: number; level: string } };
    expect(res.confidence).toBe(Math.round(draft.mapping.confidence * 100) / 100);
    expect(res.mapping_level).toBe(draft.mapping.level);
  });

  it('a draft stored before 3b (no mapping key) reads as mapping null and stays reviewable', async () => {
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: okFetch() },
    );
    const row = db.select().from(importJob).get()!;
    const stored = JSON.parse(row.draftJson!);
    delete stored.draft.mapping;
    db.update(importJob)
      .set({ draftJson: JSON.stringify(stored) })
      .run();
    const again = getImportFor(db, a, res.id)!;
    expect(again.status).toBe('needs_review');
    expect(again.confidence).toBeNull();
    expect(again.mapping_level).toBeNull();
    expect((again.draft as { mapping: unknown }).mapping).toBeNull();
  });

  it('a tampered mapping block reads as null instead of breaking the response', async () => {
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: okFetch() },
    );
    const stored = JSON.parse(db.select().from(importJob).get()!.draftJson!);
    stored.draft.mapping = { version: 1, confidence: 'high' };
    db.update(importJob)
      .set({ draftJson: JSON.stringify(stored) })
      .run();
    expect(getImportFor(db, a, res.id)).toMatchObject({ confidence: null, mapping_level: null });
  });

  it('a mapper that throws still yields a reviewable job without a proposal', async () => {
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      {
        safeFetch: okFetch(),
        mapGrid: () => {
          throw new Error('boom');
        },
        log: () => {},
      },
    );
    expect(res).toMatchObject({ status: 'needs_review', confidence: null, mapping_level: null });
    expect(res.warnings).toContain('mapping_invalid');
  });
});

describe('stale fetching jobs (lazy recovery)', () => {
  const stuck = (userId: string, ageMs: number) =>
    db
      .insert(importJob)
      .values({
        id: `J${ageMs}${userId}`,
        userId,
        status: 'fetching',
        updatedAt: new Date(Date.now() - ageMs).toISOString(),
      })
      .returning()
      .get();

  it('getImportFor fails an old fetching job, leaves a fresh one and other users alone', async () => {
    const old = stuck(a.id, STALE_FETCHING_MS + 60_000);
    const fresh = stuck(a.id, 1000);
    const theirs = stuck(b.id, STALE_FETCHING_MS + 60_000);
    expect(getImportFor(db, a, old.id)).toMatchObject({
      status: 'failed',
      error_code: 'fetch_failed',
    });
    expect(getImportFor(db, a, fresh.id)?.status).toBe('fetching');
    expect(
      db
        .select()
        .from(importJob)
        .all()
        .find((j) => j.id === theirs.id)?.status,
    ).toBe('fetching');
  });

  it("createImport sweeps the same user's stale jobs", async () => {
    const old = stuck(a.id, STALE_FETCHING_MS + 60_000);
    await createImport(db, a, { url: 'https://example.com/p' }, { safeFetch: okFetch() });
    expect(
      db
        .select()
        .from(importJob)
        .all()
        .find((j) => j.id === old.id)?.status,
    ).toBe('failed');
  });
});

describe('markImportJobSaved CAS', () => {
  it('only flips needs_review jobs', () => {
    const mkJob = (status: 'failed' | 'fetching' | 'needs_review') =>
      db
        .insert(importJob)
        .values({ id: `C${status}`, userId: a.id, status })
        .returning()
        .get();
    const r = createRecipe(db, a.id, tree(null, 'private'));
    expect(markImportJobSaved(db, mkJob('failed').id, a.id, r)).toBe(false);
    expect(markImportJobSaved(db, mkJob('fetching').id, a.id, r)).toBe(false);
    expect(markImportJobSaved(db, mkJob('needs_review').id, a.id, r)).toBe(true);
  });
});

describe('createImport: headless', () => {
  const empty = () =>
    vi.fn<(u: string, o?: SafeFetchOptions) => Promise<SafeFetchResult>>(async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: enc.encode('<html><body><div id="app"></div></body></html>'),
      finalUrl: 'https://example.com/p',
    }));

  it('persists method headless, returns headless used, and reloads it via GET', async () => {
    const render = vi.fn(async () => ({
      html: page,
      finalUrl: 'https://example.com/p',
      status: 200,
    }));
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: empty(), headless: { enabled: true, render } },
    );
    expect(res).toMatchObject({ status: 'needs_review', method: 'headless', headless: 'used' });
    expect(res.warnings).toContain('headless_used');
    expect(getImportFor(db, a, res.id)).toMatchObject({ method: 'headless', headless: 'used' });
    expect(db.select().from(recipe).all()).toHaveLength(0);
  });

  it('headless off: static no_recipe persisted, response carries headless unavailable', async () => {
    const res = await createImport(db, a, { url: 'https://example.com/p' }, { safeFetch: empty() });
    expect(res).toMatchObject({
      status: 'failed',
      method: 'static',
      error_code: 'no_recipe',
      headless: 'unavailable',
    });
    expect(getImportFor(db, a, res.id)?.headless).toBeNull(); // hint is not persisted
  });

  it('sidecar down: persists the headless_unavailable code', async () => {
    const render = vi.fn(async () => {
      throw new ImportError('headless_unavailable');
    });
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: empty(), headless: { enabled: true, render } },
    );
    expect(res).toMatchObject({
      status: 'failed',
      method: 'headless',
      error_code: 'headless_unavailable',
      headless: 'unavailable',
    });
    expect(getImportFor(db, a, res.id)).toMatchObject({
      error_code: 'headless_unavailable',
      headless: 'unavailable',
    });
  });

  it('a sidecar failure after a render attempt reads as "used" on POST and GET alike (m6)', async () => {
    const render = vi.fn(async () => {
      throw new ImportError('blocked');
    });
    const res = await createImport(
      db,
      a,
      { url: 'https://example.com/p' },
      { safeFetch: empty(), headless: { enabled: true, render } },
    );
    expect(res).toMatchObject({ error_code: 'blocked', method: 'headless', headless: 'used' });
    expect(getImportFor(db, a, res.id)?.headless).toBe('used');
  });
});
