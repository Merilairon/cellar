import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { getCoverPhoto } from '@/lib/db/photos';
import { getRecipeFull } from '@/lib/db/recipes';
import { importJob, recipe, user } from '@/lib/db/schema';
import { deleteRecipeFor } from '@/lib/recipes/service';
import { createImport, parseStoredDraft } from './service';
import { saveImport } from './save';
import type { SafeFetchOptions, SafeFetchResult } from './safe-fetch';

const enc = new TextEncoder();
const node = {
  '@type': 'Recipe',
  name: 'Pancakes',
  image: 'https://cdn.example.com/p.jpg',
  recipeIngredient: ['2 eggs'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Fry.' }],
};
const pageFetch = async (): Promise<SafeFetchResult> => ({
  status: 200,
  headers: { 'content-type': 'text/html' },
  body: enc.encode(`<script type="application/ld+json">${JSON.stringify(node)}</script>`),
  finalUrl: 'https://example.com/p',
});
const png = () =>
  sharp({ create: { width: 64, height: 32, channels: 3, background: '#fa0' } })
    .png()
    .toBuffer();

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
const draft = (over: Record<string, unknown> = {}) => ({
  title: 'Pancakes',
  source_url: 'http://Example.com/p?utm_source=x',
  sections: [
    {
      title: null,
      ingredients: [{ name: 'eggs' }],
      steps: [{ kind: 'banner_top', label: 'Fry', detail: 'Hot pan.' }],
    },
  ],
  ...over,
});
const start = async (url = 'https://example.com/p') =>
  (await createImport(db, a, { url }, { safeFetch: pageFetch })).id;
const deps = (sf?: (u: string, o?: SafeFetchOptions) => Promise<SafeFetchResult>) => ({
  uploadsDir: join(dir, 'uploads'),
  safeFetch: sf,
});

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  a = mk('a@x.test') as typeof a;
  b = mk('b@x.test') as typeof b;
  dir = mkdtempSync(join(tmpdir(), 'save-'));
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('saveImport', () => {
  it('saves an edited draft: canonical source_url with the entered scheme, hostname source_name, list, private, job saved', async () => {
    const id = await start();
    const r = await saveImport(db, a, id, draft({ title: 'Edited' }), deps());
    expect(r).toMatchObject({ ok: true, warnings: [] });
    if (!r.ok || !('id' in r)) throw new Error('unreachable');
    const full = getRecipeFull(db, r.id)!;
    expect(full).toMatchObject({
      title: 'Edited',
      ownerId: a.id,
      sourceUrl: 'http://example.com/p', // entered scheme kept, tracking params stripped (Q3)
      sourceName: 'example.com',
      viewMode: 'list',
      visibility: 'private',
    });
    expect(db.select().from(importJob).get()).toMatchObject({ status: 'saved', recipeId: r.id });
  });

  describe('tags (T5)', () => {
    const tagged = {
      '@type': 'Recipe',
      name: 'Brownies',
      keywords: 'Dessert, Chocolate',
      recipeCategory: 'Baking',
      recipeIngredient: ['2 eggs'],
      recipeInstructions: [{ '@type': 'HowToStep', text: 'Bake.' }],
    };
    const taggedFetch = async (): Promise<SafeFetchResult> => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: enc.encode(`<script type="application/ld+json">${JSON.stringify(tagged)}</script>`),
      finalUrl: 'https://example.com/p',
    });
    const startTagged = async () =>
      (await createImport(db, a, { url: 'https://example.com/p' }, { safeFetch: taggedFetch })).id;
    const tagsOf = (r: Awaited<ReturnType<typeof saveImport>>) => {
      if (!r.ok || !('id' in r)) throw new Error(`not saved: ${JSON.stringify(r)}`);
      return getRecipeFull(db, r.id)!.tags;
    };

    it('persists the draft tags (keywords + category) when the body omits tags', async () => {
      const id = await startTagged();
      expect(tagsOf(await saveImport(db, a, id, draft(), deps()))).toEqual([
        'baking',
        'chocolate',
        'dessert',
      ]);
    });

    it('tags in the payload replace the draft tags; removed ones are not saved', async () => {
      const id = await startTagged();
      expect(tagsOf(await saveImport(db, a, id, draft({ tags: ['Chocolate'] }), deps()))).toEqual([
        'chocolate',
      ]);
    });

    it('an explicit empty list saves no tags', async () => {
      const id = await startTagged();
      expect(tagsOf(await saveImport(db, a, id, draft({ tags: [] }), deps()))).toEqual([]);
      expect(db.$client.prepare('select count(*) n from tag').get()).toEqual({ n: 0 });
    });

    it('tampered tags are rejected with 422 and nothing is saved', async () => {
      const id = await startTagged();
      for (const tags of [
        ['x'.repeat(41)],
        [''],
        ['a\u0000b'],
        Array.from({ length: 21 }, (_, i) => `t${i}`),
      ]) {
        const r = await saveImport(db, a, id, draft({ tags }), deps());
        expect(r).toMatchObject({ ok: false, status: 422 });
      }
      expect(db.select().from(importJob).get()).toMatchObject({ status: 'needs_review' });
      expect(db.$client.prepare('select count(*) n from tag').get()).toEqual({ n: 0 });
    });

    it('a stored draft without tags (v0.3.x) still saves with []', async () => {
      const id = await start();
      const row = db.select().from(importJob).where(eq(importJob.id, id)).get()!;
      const stored = JSON.parse(row.draftJson!);
      delete stored.draft.tags;
      db.update(importJob)
        .set({ draftJson: JSON.stringify(stored) })
        .where(eq(importJob.id, id))
        .run();
      expect(tagsOf(await saveImport(db, a, id, draft(), deps()))).toEqual([]);
    });

    it('unusable draft tags are dropped rather than blocking the save', async () => {
      const id = await start();
      const row = db.select().from(importJob).where(eq(importJob.id, id)).get()!;
      const stored = JSON.parse(row.draftJson!);
      stored.draft.tags = ['ok', '', 'x'.repeat(60), 'OK'];
      db.update(importJob)
        .set({ draftJson: JSON.stringify(stored) })
        .where(eq(importJob.id, id))
        .run();
      expect(tagsOf(await saveImport(db, a, id, draft(), deps()))).toEqual(['ok']);
    });
  });

  it('re-sanitizes a draft tampered client-side', async () => {
    const id = await start();
    const r = await saveImport(
      db,
      a,
      id,
      draft({
        title: 'Soup<script>alert(1)</script>',
        description: '<img src=x onerror=alert(1)>Nice &lt;b&gt;',
        source_name: '<b>Site</b>',
        sections: [
          {
            title: '<i>Mains</i>',
            ingredients: [{ name: '<script>x</script>salt', note: '<a href=x>n</a>' }],
            steps: [
              {
                kind: 'banner_top',
                label: '<script>l</script>Step',
                detail: '<svg onload=x>do it',
              },
            ],
          },
        ],
      }),
      deps(),
    );
    if (!r.ok || !('id' in r)) throw new Error(JSON.stringify(r));
    const stored = JSON.stringify(getRecipeFull(db, r.id));
    expect(stored).not.toMatch(/<|onerror|onload|alert/);
    expect(getRecipeFull(db, r.id)!.title).toBe('Soup');
  });

  it('rejects non-http source_url with 422 and keeps the job reviewable', async () => {
    const id = await start();
    expect(
      await saveImport(db, a, id, draft({ source_url: 'javascript:alert(1)' }), deps()),
    ).toMatchObject({ ok: false, status: 422 });
    expect(db.select().from(importJob).get()!.status).toBe('needs_review');
  });

  it('falls back to the job URL for source_url when the draft has none', async () => {
    const id = await start('https://example.com/p?utm_source=q');
    const r = await saveImport(db, a, id, draft({ source_url: undefined }), deps());
    if (!r.ok || !('id' in r)) throw new Error('fail');
    expect(getRecipeFull(db, r.id)!.sourceUrl).toBe('https://example.com/p');
  });

  it('an emptied source_url clears it instead of falling back to the job URL', async () => {
    for (const cleared of ['', null, '   ']) {
      const id = await start('https://example.com/p');
      const r = await saveImport(db, a, id, draft({ source_url: cleared }), deps());
      if (!r.ok || !('id' in r)) throw new Error('fail');
      const full = getRecipeFull(db, r.id)!;
      expect(full.sourceUrl).toBeNull();
      expect(full.sourceName).toBeNull();
    }
  });

  it('keeps the entered http scheme and strips tracking and fragment', async () => {
    const id = await start('https://example.com/p');
    const r = await saveImport(
      db,
      a,
      id,
      draft({ source_url: 'http://Example.com/slow/?utm_source=x#c' }),
      deps(),
    );
    if (!r.ok || !('id' in r)) throw new Error('fail');
    expect(getRecipeFull(db, r.id)!.sourceUrl).toBe('http://example.com/slow');
  });

  it('second save is 409 and creates no second recipe', async () => {
    const id = await start();
    await saveImport(db, a, id, draft(), deps());
    expect(await saveImport(db, a, id, draft(), deps())).toEqual({ ok: false, status: 409 });
    expect(db.select().from(recipe).all()).toHaveLength(1);
  });

  it("another user's job and unknown ids are 404; failed jobs are 409", async () => {
    const id = await start();
    expect(await saveImport(db, b, id, draft(), deps())).toEqual({ ok: false, status: 404 });
    expect(await saveImport(db, a, 'nope', draft(), deps())).toEqual({ ok: false, status: 404 });
    const failed = await createImport(db, a, { url: 'ftp://x/' }, { safeFetch: pageFetch });
    expect(await saveImport(db, a, failed.id, draft(), deps())).toEqual({ ok: false, status: 409 });
  });

  it('never yields a grid recipe with null spans: column steps without spans default to list', async () => {
    const id = await start();
    const r = await saveImport(
      db,
      a,
      id,
      draft({
        sections: [
          { ingredients: [{ name: 'x' }], steps: [{ kind: 'column', label: 'S', detail: '' }] },
        ],
      }),
      deps(),
    );
    if (!r.ok || !('id' in r)) throw new Error('fail');
    expect(getRecipeFull(db, r.id)!.viewMode).toBe('list');
    // and an explicit grid with null spans is refused
    const id2 = await start();
    const g = await saveImport(
      db,
      a,
      id2,
      draft({
        view_mode: 'grid',
        sections: [
          { ingredients: [{ name: 'x' }], steps: [{ kind: 'column', label: 'S', detail: '' }] },
        ],
      }),
      deps(),
    );
    expect(g).toMatchObject({ ok: false, status: 422 });
  });

  describe('explicit view_mode and grid validation', () => {
    const grid = (over: Record<string, unknown> = {}, rows: [number, number] = [0, 1]) =>
      draft({
        sections: [
          {
            ingredients: [{ name: 'flour' }, { name: 'sugar' }],
            steps: [
              {
                kind: 'column',
                label: 'Mix',
                detail: 'Mix flour and sugar.',
                row_start: rows[0],
                row_end: rows[1],
              },
            ],
          },
        ],
        ...over,
      });

    it('saves a valid grid as grid when view_mode is grid', async () => {
      const id = await start();
      const r = await saveImport(db, a, id, grid({ view_mode: 'grid' }), deps());
      if (!r.ok || !('id' in r)) throw new Error(JSON.stringify(r));
      expect(getRecipeFull(db, r.id)!.viewMode).toBe('grid');
    });

    it('saves list when view_mode is list, even with valid spans', async () => {
      const id = await start();
      const r = await saveImport(db, a, id, grid({ view_mode: 'list' }), deps());
      if (!r.ok || !('id' in r)) throw new Error(JSON.stringify(r));
      expect(getRecipeFull(db, r.id)!.viewMode).toBe('list');
    });

    it('imports open as list when view_mode is omitted (v0.3.0 behaviour)', async () => {
      const id = await start();
      const r = await saveImport(db, a, id, grid(), deps());
      if (!r.ok || !('id' in r)) throw new Error(JSON.stringify(r));
      expect(getRecipeFull(db, r.id)!.viewMode).toBe('list');
    });

    it('422 for a tampered grid: span beyond the last row, no recipe, job stays reviewable', async () => {
      const id = await start();
      const r = await saveImport(db, a, id, grid({ view_mode: 'grid' }, [0, 9]), deps());
      expect(r).toMatchObject({ ok: false, status: 422 });
      if (!r.ok && r.status === 422) expect(r.errors.length).toBeGreaterThan(0);
      expect(db.select().from(recipe).all()).toHaveLength(0);
      expect(db.select().from(importJob).get()!.status).toBe('needs_review');
    });

    it('422 for end before start and negative spans in grid mode', async () => {
      for (const rows of [
        [1, 0],
        [-1, 0],
      ] as Array<[number, number]>) {
        const id = await start();
        expect(
          await saveImport(db, a, id, grid({ view_mode: 'grid' }, rows), deps()),
        ).toMatchObject({ ok: false, status: 422 });
      }
      expect(db.select().from(recipe).all()).toHaveLength(0);
    });

    it('422 for an unknown view_mode', async () => {
      const id = await start();
      expect(await saveImport(db, a, id, grid({ view_mode: 'table' }), deps())).toMatchObject({
        ok: false,
        status: 422,
      });
    });

    it('a mapper proposal from the stored draft saves as a valid grid', async () => {
      const rich = {
        '@type': 'Recipe',
        name: 'Cake',
        recipeIngredient: ['1 cup flour', '1 cup sugar', '2 eggs'],
        recipeInstructions: [
          'Whisk the flour and sugar.',
          'Beat in the eggs.',
          'Bake for 30 minutes at 180C.',
        ],
      };
      const richFetch = async (): Promise<SafeFetchResult> => ({
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: enc.encode(`<script type="application/ld+json">${JSON.stringify(rich)}</script>`),
        finalUrl: 'https://example.com/cake',
      });
      const id = (
        await createImport(db, a, { url: 'https://example.com/cake' }, { safeFetch: richFetch })
      ).id;
      const stored = parseStoredDraft(db.select().from(importJob).get()!.draftJson)!;
      expect(stored.draft.mapping).not.toBeNull();
      const proposal = stored.draft.mapping!;
      const r = await saveImport(
        db,
        a,
        id,
        { title: 'Mapped', view_mode: 'grid', sections: proposal.sections },
        deps(),
      );
      if (!r.ok || !('id' in r)) throw new Error(JSON.stringify(r));
      expect(getRecipeFull(db, r.id)!.viewMode).toBe('grid');
    });
  });

  it('rolls back fully when the recipe insert fails; job stays needs_review', async () => {
    const id = await start();
    // Force a failure inside the transaction: a duplicate ingredient name is fine, so break the FK
    // by making the job update throw after the recipe insert.
    const jobs = await import('@/lib/db/import-jobs');
    vi.spyOn(jobs, 'markImportJobSaved').mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(saveImport(db, a, id, draft(), deps())).rejects.toThrow('boom');
    expect(db.select().from(recipe).all()).toHaveLength(0);
    expect(db.select().from(importJob).where(eq(importJob.id, id)).get()!.status).toBe(
      'needs_review',
    );
  });
});

describe('saveImport cover (T8)', () => {
  it('imports the cover from the STORED draft URL (not the request) via safeFetch accept image', async () => {
    const id = await start();
    const sf = vi.fn(async (...[,]: [string, SafeFetchOptions?]): Promise<SafeFetchResult> => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: await png(),
      finalUrl: 'https://cdn.example.com/p.jpg',
    }));
    const r = await saveImport(
      db,
      a,
      id,
      draft({ import_cover: true, cover_image_url: 'http://169.254.169.254/evil.png' }),
      deps(sf),
    );
    if (!r.ok || !('id' in r)) throw new Error('fail');
    expect(sf).toHaveBeenCalledTimes(1);
    expect(sf.mock.calls[0]![0]).toBe('https://cdn.example.com/p.jpg');
    expect(sf.mock.calls[0]![1]).toMatchObject({ accept: 'image' });
    const cover = getCoverPhoto(db, r.id)!;
    expect(cover).toMatchObject({ width: 64, height: 32 });
    expect(existsSync(join(dir, 'uploads', cover.filePath))).toBe(true);

    // deleting the recipe removes the file
    deleteRecipeFor(db, a, r.id, { uploadsDir: join(dir, 'uploads') });
    expect(existsSync(join(dir, 'uploads', cover.filePath))).toBe(false);
  });

  it('a failed cover never blocks the save: recipe saved, cover_failed warning', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await start();
    const r = await saveImport(
      db,
      a,
      id,
      draft({ import_cover: true }),
      deps(async () => {
        throw new Error('network down');
      }),
    );
    expect(r).toMatchObject({ ok: true, warnings: ['cover_failed'] });
    expect(db.select().from(recipe).all()).toHaveLength(1);
    expect(db.select().from(importJob).get()!.status).toBe('saved');
  });

  it('a pixel bomb cover (declared 25 MP, tiny on the wire) is refused: saved without cover, no file', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bomb = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(200_000);
    const id = await start();
    const r = await saveImport(
      db,
      a,
      id,
      draft({ import_cover: true }),
      deps(async () => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: bomb,
        finalUrl: 'https://cdn.example.com/p.jpg',
      })),
    );
    expect(r).toMatchObject({ ok: true, warnings: ['cover_failed'] });
    if (!r.ok || !('id' in r)) throw new Error('fail');
    expect(getCoverPhoto(db, r.id)).toBeUndefined();
    expect(existsSync(join(dir, 'uploads'))).toBe(false);
  });

  it('a cover whose header lies about its size (undeclared pixels) never produces a file', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const lying = Buffer.from(real);
    lying.writeUInt32BE(8, 16); // IHDR width -> 8, height -> 8; CRC no longer matches
    lying.writeUInt32BE(8, 20);
    const id = await start();
    const r = await saveImport(
      db,
      a,
      id,
      draft({ import_cover: true }),
      deps(async () => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: lying,
        finalUrl: 'https://cdn.example.com/p.jpg',
      })),
    );
    expect(r).toMatchObject({ ok: true, warnings: ['cover_failed'] });
    if (!r.ok || !('id' in r)) throw new Error('fail');
    expect(getCoverPhoto(db, r.id)).toBeUndefined();
    expect(existsSync(join(dir, 'uploads'))).toBe(false);
  });

  it('does not fetch a cover when import_cover is false', async () => {
    const id = await start();
    const sf = vi.fn();
    await saveImport(db, a, id, draft({ import_cover: false }), deps(sf));
    expect(sf).not.toHaveBeenCalled();
  });

  it('a non-boolean import_cover is a 422', async () => {
    const id = await start();
    expect(await saveImport(db, a, id, draft({ import_cover: 'yes' }), deps())).toMatchObject({
      ok: false,
      status: 422,
    });
  });

  it('fills the missing alternate measure at import save (4 oz butter -> 115 g)', async () => {
    const id = await start();
    const body = draft({
      sections: [
        {
          title: null,
          ingredients: [
            { name: 'butter', us_qty: 4, us_unit: 'oz', display_primary: 'us' },
            { name: 'sugar', us_qty: 1, us_unit: 'cup', metric_qty: 190, metric_unit: 'g' },
          ],
          steps: [{ kind: 'banner_top', label: 'Fry', detail: 'Hot pan.' }],
        },
      ],
    });
    const r = await saveImport(db, a, id, body, deps());
    if (!r.ok) throw new Error(JSON.stringify(r));
    const [butter, sugar] = getRecipeFull(db, r.id)!.sections[0]!.ingredients;
    expect([butter!.metricQty, butter!.metricUnit, butter!.displayPrimary]).toEqual([
      115,
      'g',
      'us',
    ]);
    expect(sugar!.metricQty).toBe(190);
  });
});
