import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ulid } from 'ulid';
import { rawZip } from '@/lib/backup/unzip-test-util';
import { readZip } from '@/lib/backup/zip-test-util';
import { type Account } from './helpers';

// Shared by backup.spec.ts, backup-a11y.spec.ts and backup-visual.spec.ts (T12). No test lives
// here. Instance A is :3100 (the default baseURL); instance B is :3103 (playwright.config.ts).

export const BASE_A = 'http://localhost:3100';
export const BASE_B = 'http://localhost:3103';
export const ORIGIN_A = { origin: BASE_A };
export const ORIGIN_B = { origin: BASE_B };

/**
 * The text of an ICU plural message from messages/en.json for a given count, so specs assert the
 * catalog and not a copy of it. Only handles `{count, plural, one {...} other {...}}` with `#`.
 */
export function icuPlural(template: string, n: number): string {
  const branch = new RegExp(`${n === 1 ? 'one' : 'other'} \\{([^{}]*)\\}`).exec(template);
  if (!branch) throw new Error(`no plural branch for ${n} in ${template}`);
  return branch[1].replace('#', String(n));
}

/** Both servers are on `localhost`, and cookies ignore ports: A and B never share a context. */
export const newContextAt = (browser: Browser, baseURL: string) => browser.newContext({ baseURL });

/** First-run setup on a fresh instance through the UI; returns when the login page shows. */
export async function setupAdmin(browser: Browser, baseURL: string, who: Account) {
  const ctx = await newContextAt(browser, baseURL);
  const page = await ctx.newPage();
  await page.goto('/setup');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Display name').fill(who.name);
  await page.getByLabel(/^Password/).fill(who.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await ctx.close();
}

export async function signInAt(browser: Browser, baseURL: string, who: Account) {
  const ctx = await newContextAt(browser, baseURL);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  return ctx;
}

/** Admin invites `who` on the instance at `baseURL` (UI), the invite is redeemed in a throwaway context. */
export async function inviteAt(browser: Browser, baseURL: string, admin: Account, who: Account) {
  const adminCtx = await signInAt(browser, baseURL, admin);
  const ap = await adminCtx.newPage();
  await ap.goto('/admin/users');
  await ap.getByRole('button', { name: 'Create invite link' }).click();
  const link = await ap.getByTestId('one-time-link').first().innerText();
  await adminCtx.close();

  const ctx = await newContextAt(browser, baseURL);
  const p = await ctx.newPage();
  await p.goto(link);
  await p.getByLabel('Email').fill(who.email);
  await p.getByLabel('Display name').fill(who.name);
  await p.getByLabel(/^Password/).fill(who.password);
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p).toHaveURL(/\/login|error=email_taken/);
  await ctx.close();
}

/* ---------- reading what an export produced ---------- */

type Json = Record<string, unknown>;
export type BackupDoc = {
  version: number;
  scope: 'own' | 'all';
  exported_at: string;
  users?: Json[];
  recipes: Array<{
    title: string;
    photos: Json[];
    notes: Json[];
    ratings: Json[];
    sections: Array<{ ingredients: Json[]; steps: Json[] }>;
    [k: string]: unknown;
  }>;
};

/** The `backup.json` of a zip export (entries are stored, no inflate needed) plus its entry names. */
export function readExportZip(zip: Buffer): { doc: BackupDoc; names: string[] } {
  const entries = readZip(zip);
  const manifest = entries.find((e) => e.name === 'backup.json');
  if (!manifest) throw new Error('backup.json missing');
  return {
    doc: JSON.parse(manifest.data.toString('utf8')) as BackupDoc,
    names: entries.map((e) => e.name),
  };
}

/** What the preview must report for `doc`, counted independently from the export itself. */
export function countsOf(doc: BackupDoc) {
  const sum = (f: (r: BackupDoc['recipes'][number]) => number) =>
    doc.recipes.reduce((n, r) => n + f(r), 0);
  return {
    recipes: doc.recipes.length,
    sections: sum((r) => r.sections.length),
    ingredients: sum((r) => r.sections.reduce((n, s) => n + s.ingredients.length, 0)),
    notes: sum((r) => r.notes.length),
    ratings: sum((r) => r.ratings.length),
    photos: sum((r) => r.photos.length),
  };
}

/* ---------- id- and stamp-free recipe trees ---------- */

const DROP = new Set([
  'id',
  'owner_id',
  'copied_from_id',
  'created_at',
  'updated_at',
  'share',
  'public_links_enabled',
  'split_group_id',
]);

/**
 * A recipe as `GET /api/recipes/:id` returns it, minus row ids and stamps. Split-group ids
 * become ordinals (first appearance), so two instances compare equal when the groups match.
 * Photos keep dimensions, cover flag and order only. Everything else is kept: sections,
 * ingredients (all quantities and units), steps with `row_start` / `row_end`, tags,
 * visibility, view_mode, rating summary.
 */
export function stripTree(tree: Json): Json {
  const groups = new Map<string, number>();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const o = v as Json;
      const out: Json = {};
      for (const [k, x] of Object.entries(o)) {
        if (k === 'photos') {
          out[k] = (x as Json[]).map((p) => ({
            width: p.width,
            height: p.height,
            is_cover: p.is_cover,
          }));
        } else if (DROP.has(k)) {
          if (k === 'split_group_id') {
            const id = x as string | null;
            if (id === null) out.split_group = null;
            else {
              if (!groups.has(id)) groups.set(id, groups.size);
              out.split_group = groups.get(id);
            }
          }
        } else out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(tree) as Json;
}

/** Notes as one viewer sees them, minus ids and stamps. Order is kept (creation order). */
export const stripNotes = (notes: Json[]) =>
  notes.map((n) => ({ body: n.body, shared: n.shared, author: n.author, mine: n.mine }));

/* ---------- a recipe by title, per viewer ---------- */

export async function listTitles(ctx: BrowserContext) {
  const res = await ctx.request.get('/api/recipes');
  expect(res.status()).toBe(200);
  return (
    (await res.json()) as {
      recipes: Array<{ id: string; title: string; owner_display_name: string }>;
    }
  ).recipes;
}

export async function getTree(ctx: BrowserContext, id: string): Promise<Json> {
  const res = await ctx.request.get(`/api/recipes/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Json;
}

export async function getNotes(ctx: BrowserContext, id: string): Promise<Json[]> {
  const res = await ctx.request.get(`/api/recipes/${id}/notes`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { notes: Json[] }).notes;
}

/* ---------- hand-made backup documents (for the a11y and visual specs) ---------- */

const STAMP = '2026-01-01T00:00:00.000Z';

/** A valid, minimal v1 recipe (list view, one ingredient, one step). */
export function docRecipe(title: string, extra: Json = {}): Json {
  return {
    title,
    description: null,
    servings: 4,
    servings_label: null,
    prep_minutes: null,
    cook_minutes: null,
    source_url: null,
    source_name: null,
    visibility: 'private',
    view_mode: 'list',
    created_at: STAMP,
    updated_at: STAMP,
    tags: [],
    sections: [
      {
        position: 0,
        title: null,
        ingredients: [
          {
            position: 0,
            name: 'flour',
            note: null,
            raw_text: '200 g flour',
            metric_qty: 200,
            metric_qty_max: null,
            metric_unit: 'g',
            us_qty: null,
            us_qty_max: null,
            us_unit: null,
            display_primary: 'metric',
            split_group_key: null,
            portion_label: null,
            group_label: null,
          },
        ],
        steps: [
          {
            position: 0,
            kind: 'column',
            label: 'mix',
            detail: 'Mix everything.',
            row_start: null,
            row_end: null,
            temp_c: null,
            temp_f: null,
            minutes_min: null,
            minutes_max: null,
          },
        ],
      },
    ],
    photos: [],
    notes: [],
    ratings: [],
    ...extra,
  };
}

export const ownDoc = (recipes: Json[], extra: Json = {}): Json => ({
  version: 1,
  exported_at: STAMP,
  app_version: '0.5.1',
  scope: 'own',
  recipes,
  ...extra,
});

export const allDoc = (users: Array<{ email: string; name: string }>, recipes: Json[]): Json => ({
  version: 1,
  exported_at: STAMP,
  app_version: '0.5.1',
  scope: 'all',
  users: users.map((u) => ({
    email: u.email,
    display_name: u.name,
    role: 'member',
    unit_pref: 'metric',
    locale: 'en',
  })),
  recipes,
});

export const jsonFile = (name: string, doc: unknown) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(doc)),
});

/* ---------- the /backup page ---------- */

/** Choose `file` and press Check; resolves when the preview heading is shown. */
export async function chooseAndCheck(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Check the file' }).click();
}

/** Wait until React has hydrated the restore picker (a change event before that is lost). */
export async function backupReady(page: Page) {
  await page.goto('/backup');
  await expect(page.getByRole('heading', { name: 'Restore', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('input[type="file"]')
        .evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))),
    )
    .toBe(true);
}

/** Answer the next matching request with a canned JSON response (one shot). */
export async function mockOnce(
  page: Page,
  pattern: RegExp,
  method: string,
  status: number,
  body: object,
) {
  await page.route(
    pattern,
    (route) =>
      route.request().method() === method
        ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
        : route.fallback(),
    { times: 1 },
  );
}

/** Gates of held requests that were not released yet; see abortHeld. */
const heldGates: Array<(proceed: boolean) => void> = [];

/** Hold the next matching request until `release()` is called, then let it through. */
export async function holdOnce(page: Page, pattern: RegExp, method: string) {
  let settle!: (proceed: boolean) => void;
  const gate = new Promise<boolean>((r) => (settle = r));
  heldGates.push(settle);
  await page.route(
    pattern,
    async (route) => {
      if (route.request().method() !== method) return route.fallback();
      if (await gate) await route.continue();
      else await route.abort();
    },
    { times: 1 },
  );
  return () => settle(true);
}

/**
 * Call from afterEach in a spec that uses holdOnce. A test that fails before it releases would
 * otherwise leave the request pending, and it could reach the server after the spec's cleanup
 * (a held restore then adds recipes and photos that the next spec's admin export counts). An
 * already released gate is unaffected.
 */
export function abortHeld() {
  for (const settle of heldGates.splice(0)) settle(false);
}

/** The Restore section's alert (Next's route announcer is a second role=alert on every page). */
export const restoreAlert = (page: Page) =>
  page.getByRole('region', { name: 'Restore' }).getByRole('alert');

/* ---------- states shared by the a11y and visual specs ---------- */

/** An own-scope document of fresh titles, with one note of the caller's and one of another user's, and one rating. */
export const freshDoc = (tag: string, n = 2): Json =>
  ownDoc(
    Array.from({ length: n }, (_, i) =>
      docRecipe(`${tag} ${i + 1}`, {
        tags: ['dessert'],
        notes:
          i === 0
            ? [
                {
                  body: 'Less sugar next time.',
                  shared: false,
                  author_display_name: 'Me',
                  mine: true,
                  created_at: STAMP,
                  updated_at: STAMP,
                },
                {
                  body: 'Lovely with cream.',
                  shared: true,
                  author_display_name: 'Someone else',
                  mine: false,
                  created_at: STAMP,
                  updated_at: STAMP,
                },
              ]
            : [],
        ratings: i === 0 ? [{ stars: 4, created_at: STAMP, updated_at: STAMP }] : [],
      }),
    ),
  );

/** A zip backup whose recipes each carry one real photo (re-encoded by the restore). */
export async function photoZip(tag: string, n = 2) {
  const entries: Array<{ name: string; data: Buffer }> = [];
  const recipes = [];
  for (let i = 0; i < n; i++) {
    const file = `photos/${ulid()}.webp`;
    const data = await sharp({
      create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 120, b: 60 } },
    })
      .webp()
      .toBuffer();
    entries.push({ name: file, data });
    recipes.push(
      docRecipe(`${tag} ${i + 1}`, {
        photos: [{ position: 0, is_cover: true, width: 120, height: 90, file, thumb: null }],
      }),
    );
  }
  const manifest = Buffer.from(JSON.stringify(ownDoc(recipes)));
  return rawZip([{ name: 'backup.json', data: manifest }, ...entries]);
}

/** Choose a file, press Check, and wait for the preview (focus lands on its caption). */
export async function stage(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await chooseAndCheck(page, file);
  await expect(page.getByText('Backup contents', { exact: true })).toBeFocused();
}

/** Delete every recipe `ctx`'s user owns whose title starts with `prefix`. */
export async function deleteOwned(ctx: BrowserContext, ownerName: string, prefix: string) {
  const rows = await listTitles(ctx);
  for (const r of rows) {
    if (r.owner_display_name === ownerName && r.title.startsWith(prefix)) {
      await ctx.request.delete(`/api/recipes/${r.id}`, { headers: ORIGIN_A });
    }
  }
}
