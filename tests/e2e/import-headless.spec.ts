import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { account, registerViaInvite, signIn } from './helpers';

/**
 * T13: the static -> headless -> paste chain. Three servers share one DB (playwright.config.ts):
 *  - OFF (:3101) has HEADLESS_URL unset, the default deployment.
 *  - ON  (:3102) has HEADLESS_URL pointing at tests/e2e/stub-sidecar.mjs (canned render
 *    responses, call log). The real browser is covered by docker/browser tests and the CI
 *    `headless` job, not here.
 * Both have the local fixture seam on, so the importer can reach the fixture server below.
 */
test.describe.configure({ mode: 'serial' });

const OFF = 'http://localhost:3101';
const ON = 'http://localhost:3102';
const STUB = 'http://127.0.0.1:3199';
const DB_FILE = 'data/e2e.db';

const me = account('headless');
const limited = account('headlimit');
const axeUser = account('heada11y');
let offCtx: BrowserContext;
let onCtx: BrowserContext;
let off: Page;
let on: Page;
let fixtures: Server;
let fx = '';

const ldHtml = (
  name: string,
) => `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name,
  recipeYield: '4 servings',
  recipeIngredient: ['2 cups flour', '1 cup sugar', '3 eggs'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Mix the flour and the sugar.' },
    { '@type': 'HowToStep', text: 'Bake until golden.' },
  ],
})}</script></head><body><h1>${name}</h1></body></html>`;

const setRules = async (rules: Record<string, object>) => {
  const res = await fetch(`${STUB}/__rules`, { method: 'PUT', body: JSON.stringify(rules) });
  expect(res.status).toBe(200);
};
const stubCalls = async () => (await (await fetch(`${STUB}/__calls`)).json()) as string[];
const resetStub = async () => void (await fetch(`${STUB}/__rules`, { method: 'DELETE' }));

/** Methods of the user's import jobs, newest first. */
function jobMethods(email: string) {
  const db = new Database(DB_FILE, { readonly: true });
  try {
    return (
      db
        .prepare(
          `SELECT j.method AS method FROM import_job j JOIN user u ON u.id = j.user_id
           WHERE u.email = ? ORDER BY j.created_at DESC, j.id DESC`,
        )
        .all(email) as { method: string | null }[]
    ).map((r) => r.method);
  } finally {
    db.close();
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await registerViaInvite(browser, me);
  await registerViaInvite(browser, limited);
  await registerViaInvite(browser, axeUser);
  fixtures = createServer((req, res) => {
    const send = (status: number, body: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    switch (req.url) {
      case '/js-only': // recipe is injected by script: no JSON-LD in the served HTML
        return send(200, '<!doctype html><title>App</title><div id="app"></div><script></script>');
      case '/forbidden':
        return send(403, '<!doctype html><title>Denied</title><p>Access denied</p>');
      case '/boom':
        return send(500, '<p>boom</p>');
      case '/cake':
        return send(200, ldHtml('Static Cake'));
      default:
        return send(404, 'not found');
    }
  });
  await new Promise<void>((ok) => fixtures.listen(0, '127.0.0.1', ok));
  fx = `http://127.0.0.1:${(fixtures.address() as AddressInfo).port}`;

  offCtx = await browser.newContext({ baseURL: OFF });
  onCtx = await browser.newContext({ baseURL: ON });
  off = await offCtx.newPage();
  on = await onCtx.newPage();
  await signIn(off, me);
  await signIn(on, me);
});
test.afterAll(async () => {
  await resetStub();
  await offCtx?.close();
  await onCtx?.close();
  await new Promise((ok) => fixtures?.close(ok));
});
test.beforeEach(resetStub);

const recipeCount = async (ctx: BrowserContext) => {
  const res = await ctx.request.get('/api/recipes');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { recipes: unknown[] }).recipes.length;
};

/** Clicks before hydration are lost on the dev servers; React tags hydrated nodes. */
async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))))
    .toBe(true);
}

async function importUrl(page: Page, url: string) {
  await page.goto('/import');
  await hydrated(page.getByLabel('Recipe web address'));
  await page.getByLabel('Recipe web address').fill(url);
  await page.getByRole('button', { name: 'Import recipe' }).click();
}

const alertOf = (page: Page) => page.getByRole('main').getByRole('alert');

test('headless off: a page without recipe data says a browser load is unavailable, paste recovers', async () => {
  const before = await recipeCount(offCtx);
  await importUrl(off, `${fx}/js-only`);
  const alert = alertOf(off);
  await expect(alert).toContainText('The recipe could not be imported');
  await expect(alert).toContainText('Loading this page in a browser is not available');
  await expect(alert).toContainText('You can paste the recipe text or the page source instead.');
  // No internals leak into the message.
  await expect(alert).not.toContainText(/sidecar|3199|127\.0\.0\.1|HEADLESS/i);
  const paste = off.getByLabel('Recipe text or page source');
  await expect(paste).toBeFocused();
  expect(await recipeCount(offCtx)).toBe(before); // a failed import creates nothing
  expect(jobMethods(me.email)[0]).toBe('static');

  await paste.fill(
    'Recovered Porridge\n\nIngredients\n1 cup oats\n2 cups milk\n\nInstructions\nHeat the milk.\nStir in the oats.',
  );
  await off.getByRole('button', { name: 'Import recipe' }).click();
  await expect(off.getByLabel('Title', { exact: true })).toHaveValue('Recovered Porridge');
  await expect(off.getByText('Page was loaded in a browser')).toHaveCount(0);
  await off.getByRole('button', { name: 'Save imported recipe' }).click();
  await expect(off).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  expect(await recipeCount(offCtx)).toBe(before + 1);
  expect(jobMethods(me.email)[0]).toBe('paste');
  expect(await stubCalls()).toEqual([]); // the stub was never involved
});

test('headless on: JS-only page shows the rendering state, then review with the note; save works', async () => {
  const url = `${fx}/js-only`;
  await setRules({ [url]: { html: ldHtml('Rendered Lemon Cake'), delayMs: 9500 } });
  const before = await recipeCount(onCtx);

  await importUrl(on, url);
  await expect(on.getByRole('progressbar')).toBeVisible();
  // After the 8 s client timer the label switches (presentational heuristic, G15).
  await expect(on.getByText('Rendering the page')).toBeVisible({ timeout: 15_000 });

  await expect(on.getByRole('heading', { name: 'Review the imported recipe' })).toBeVisible();
  await expect(on.getByText('Page was loaded in a browser')).toBeVisible();
  await expect(on.getByLabel('Title', { exact: true })).toHaveValue('Rendered Lemon Cake');
  await expect(on.getByLabel('Ingredients')).toHaveValue(/2 cups flour\n1 cup sugar\n3 eggs/);
  await expect(on.getByRole('region', { name: 'Automatic grid' })).toBeVisible();
  expect(await recipeCount(onCtx)).toBe(before);
  expect(jobMethods(me.email)[0]).toBe('headless');
  expect(await stubCalls()).toEqual([url]);

  await on.getByRole('button', { name: 'Save imported recipe' }).click();
  await expect(on).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(on.getByRole('heading', { name: 'Rendered Lemon Cake', level: 1 })).toBeVisible();
  expect(await recipeCount(onCtx)).toBe(before + 1);
});

test('headless on: a static 403 is retried in the browser and the review carries the note', async () => {
  const url = `${fx}/forbidden`;
  await setRules({ [url]: { html: ldHtml('Unblocked Soup') } });
  await importUrl(on, url);
  await expect(on.getByLabel('Title', { exact: true })).toHaveValue('Unblocked Soup');
  await expect(on.getByText('Page was loaded in a browser')).toBeVisible();
  expect(await stubCalls()).toEqual([url]);
  expect(jobMethods(me.email)[0]).toBe('headless');
});

test('headless on: the site still blocks -> blocked message, browser also tried, paste offered', async () => {
  const url = `${fx}/forbidden`;
  await setRules({ [url]: { error: 'blocked' } });
  const before = await recipeCount(onCtx);
  await importUrl(on, url);
  const alert = alertOf(on);
  await expect(alert).toContainText('The site did not allow us to read this page.');
  await expect(alert).toContainText('We also tried loading the page in a browser.');
  await expect(alert).toContainText('You can paste the recipe text or the page source instead.');
  await expect(on.getByLabel('Recipe text or page source')).toBeFocused();
  expect(await recipeCount(onCtx)).toBe(before);
  expect(await stubCalls()).toEqual([url]);
});

test('headless on: the sidecar times out -> timeout message and paste', async () => {
  const url = `${fx}/js-only`;
  await setRules({ [url]: { error: 'timeout' } });
  const before = await recipeCount(onCtx);
  await importUrl(on, url);
  await expect(alertOf(on)).toContainText('The site took too long to respond.');
  await expect(on.getByLabel('Recipe text or page source')).toBeFocused();
  expect(await recipeCount(onCtx)).toBe(before);
});

test('headless on: sidecar failure -> headless_unavailable message; paste recovers', async () => {
  // No rule: the stub answers {error:'failed'}, which the app maps to headless_unavailable.
  await importUrl(on, `${fx}/js-only`);
  await expect(alertOf(on)).toContainText('Loading this page in a browser is not available');
  await expect(alertOf(on)).not.toContainText(/3199|127\.0\.0\.1|sidecar/i);
  const paste = on.getByLabel('Recipe text or page source');
  await expect(paste).toBeFocused();
  await paste.fill(
    'Rescued Oats\n\nIngredients\n1 cup oats\n2 cups milk\n\nInstructions\nHeat the milk.\nStir in the oats.',
  );
  await on.getByRole('button', { name: 'Import recipe' }).click();
  await expect(on.getByLabel('Title', { exact: true })).toHaveValue('Rescued Oats');
  expect(jobMethods(me.email)[0]).toBe('paste');
});

test('headless on: errors that headless cannot fix never call the sidecar', async () => {
  // A plain 500 (fetch_failed) is not in the trigger table; a page with a recipe needs no browser.
  await importUrl(on, `${fx}/boom`);
  await expect(alertOf(on)).toContainText('The page could not be fetched.');
  await importUrl(on, `${fx}/cake`);
  await expect(on.getByLabel('Title', { exact: true })).toHaveValue('Static Cake');
  await expect(on.getByText('Page was loaded in a browser')).toHaveCount(0);
  expect(await stubCalls()).toEqual([]);
});

test('rate limit: a headless import counts once', async ({ browser }) => {
  // Limit on :3102 is 10 per user. Five headless (each = static 403 + render) plus five static
  // imports use exactly 10 slots; a double-counted headless import would exhaust it earlier.
  const ctx = await browser.newContext({ baseURL: ON });
  const page = await ctx.newPage();
  await signIn(page, limited);
  const url = `${fx}/forbidden`;
  await setRules({ [url]: { html: ldHtml('Counted Once') } });
  const post = (target: string) =>
    ctx.request.post('/api/import', { headers: { origin: ON }, data: { url: target } });
  for (let i = 0; i < 5; i++) expect((await post(url)).status()).toBe(200);
  for (let i = 0; i < 5; i++) expect((await post(`${fx}/cake`)).status()).toBe(200);
  expect(await stubCalls()).toHaveLength(5);
  expect((await post(`${fx}/cake`)).status()).toBe(429);
  await ctx.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: headless states (${scheme})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({
      baseURL: ON,
      viewport: { width: 375, height: 900 },
      colorScheme: scheme,
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await signIn(page, axeUser);
    const expectNoViolations = async () => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
      ).toEqual([]);
    };

    // Review with the headless note.
    const ok = `${fx}/forbidden`;
    await setRules({ [ok]: { html: ldHtml(`Axe Rendered ${scheme}`) } });
    await importUrl(page, ok);
    await expect(page.getByText('Page was loaded in a browser')).toBeVisible();
    await expectNoViolations();

    // headless_unavailable, blocked + headlessTried.
    await setRules({});
    await importUrl(page, `${fx}/js-only`);
    await expect(alertOf(page)).toContainText('not available');
    await expectNoViolations();
    await setRules({ [ok]: { error: 'blocked' } });
    await importUrl(page, ok);
    await expect(alertOf(page)).toContainText('We also tried loading the page in a browser.');
    await expectNoViolations();
    await ctx.close();
  });
}
