import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { account, BASE, registerViaInvite, signIn } from './helpers';

/**
 * Import flow (T14). Two app servers share one DB (see playwright.config.ts):
 *  - SEAM (:3101) runs with IMPORT_ALLOW_LOCAL_FETCH=true so the importer can reach the local
 *    fixture server started below. Every flow that needs a successful fetch runs there.
 *  - BASE (:3100) is the plain production server: the SSRF guard is fully on, so a loopback
 *    address must come back as private_address.
 * The normalizer upgrades every cover image URL to https, so images are served over TLS with a
 * throwaway self-signed certificate (openssl); the SEAM server runs with
 * NODE_TLS_REJECT_UNAUTHORIZED=0 to accept it. Cookies are per host, not per port, but each context signs in on the server it talks to.
 */
test.describe.configure({ mode: 'serial' });

const SEAM = 'http://localhost:3101';
const UPLOADS = 'data/e2e-uploads'; // UPLOADS_DIR of both e2e servers

const me = account('imogen');
let seamCtx: BrowserContext;
let sp: Page; // signed in on SEAM
let fixtures: Server; // recipe pages (http)
let images: Server; // cover images (https, see below)
let certDir = '';
let fx = ''; // fixture page server origin
let ix = ''; // fixture image server origin

// 1x1 PNG: sharp must be able to decode and re-encode it for the cover to be saved.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const recipePage = (o: { name: string; image: string; step?: string }) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${o.name}</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: o.name,
  image: o.image,
  recipeYield: '4 servings',
  recipeIngredient: ['2 cups flour', '1 cup sugar', '3 eggs'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Mix the flour and the sugar.' },
    { '@type': 'HowToStep', text: o.step ?? 'Bake until golden.' },
  ],
}).replace(/</g, '\\u003c')}</script></head><body><h1>${o.name}</h1></body></html>`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);

  fixtures = createServer((req, res) => {
    const html = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    switch (req.url) {
      case '/cake':
        return html(recipePage({ name: 'Fixture Lemon Cake', image: `${ix}/cover.png` }));
      case '/bad-cover':
        return html(recipePage({ name: 'Fixture Missing Cover', image: `${ix}/nope.png` }));
      case '/hostile':
        return html(
          recipePage({
            name: 'Fixture Hostile Soup',
            image: `${ix}/cover.png`,
            step: 'Stir <script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2"> gently.',
          }),
        );
      case '/no-recipe':
        return html('<!doctype html><title>Blog</title><p>Just a story, no recipe data.</p>');
      case '/boom':
        res.writeHead(500, { 'content-type': 'text/html' });
        return res.end('<p>boom</p>');
      default:
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
    }
  });
  certDir = mkdtempSync(join(tmpdir(), 'e2e-tls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
    ].concat(['-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')]),
    { stdio: 'ignore' },
  );
  images = createTlsServer(
    { key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) },
    (req, res) => {
      if (req.url === '/cover.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(PNG);
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    },
  );
  await new Promise<void>((ok) => fixtures.listen(0, '127.0.0.1', ok));
  await new Promise<void>((ok) => images.listen(0, '127.0.0.1', ok));
  fx = `http://127.0.0.1:${(fixtures.address() as AddressInfo).port}`;
  ix = `https://127.0.0.1:${(images.address() as AddressInfo).port}`;

  seamCtx = await browser.newContext({ baseURL: SEAM });
  sp = await seamCtx.newPage();
  await signIn(sp, me);
});
test.afterAll(async () => {
  await seamCtx?.close();
  await new Promise((ok) => fixtures?.close(ok));
  await new Promise((ok) => images?.close(ok));
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

const recipeCount = async (ctx: BrowserContext) => {
  const res = await ctx.request.get('/api/recipes');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { recipes: unknown[] }).recipes.length;
};
const coverFiles = () => {
  try {
    return readdirSync(UPLOADS).length;
  } catch {
    return 0; // directory is created on first save
  }
};

/**
 * The SEAM server is `next dev`: pages are slower to hydrate than in a production build, and a
 * click or fill before hydration is lost (controlled inputs are reset). React tags hydrated
 * DOM nodes with a __reactProps$ key, so wait on that instead of on the clock.
 */
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

test('URL import -> review -> edit -> save lands in list view with source link and cover', async () => {
  const before = await recipeCount(seamCtx);
  const covers = coverFiles();
  await importUrl(sp, `${fx}/cake`);

  await expect(sp.getByRole('heading', { name: 'Review the imported recipe' })).toBeVisible();
  await expect(sp.getByText('Source: 127.0.0.1')).toBeVisible();
  await expect(sp.getByLabel('Title', { exact: true })).toHaveValue('Fixture Lemon Cake');
  await expect(sp.getByLabel('Ingredients')).toHaveValue(/2 cups flour\n1 cup sugar\n3 eggs/);
  await expect(sp.getByLabel('Include the cover image from the source')).toBeChecked();
  expect(await recipeCount(seamCtx)).toBe(before); // a draft is not a recipe

  // Reloading restores the draft from the job, not from client state.
  await sp.reload();
  await expect(sp.getByLabel('Title', { exact: true })).toHaveValue('Fixture Lemon Cake');

  await sp.getByLabel('Title', { exact: true }).fill('Edited Lemon Cake');
  await sp.getByRole('button', { name: 'Save imported recipe' }).click();

  await expect(sp).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(sp.getByRole('heading', { name: 'Edited Lemon Cake', level: 1 })).toBeVisible();
  await expect(sp.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  // The stored source URL is the normalized form, which is always https (source-url.ts).
  await expect(sp.getByRole('link', { name: '127.0.0.1' })).toHaveAttribute(
    'href',
    `${fx.replace('http:', 'https:')}/cake`,
  );
  await expect(sp.getByText('the cover image could not be downloaded')).toHaveCount(0);
  expect(sp.url()).not.toContain('notice=');
  expect(await recipeCount(seamCtx)).toBe(before + 1);
  // No UI shows the cover yet (media UI is 04c), so check that the re-encoded file landed.
  expect(coverFiles()).toBe(covers + 1);
});

test('importing the same address again shows the duplicate banner; "Import anyway" dismisses it', async () => {
  await importUrl(sp, `${fx}/cake`);
  const banner = sp.getByRole('status').filter({ hasText: 'You already have a recipe' });
  await expect(banner).toContainText('Edited Lemon Cake');
  await expect(banner.getByRole('link', { name: 'Open the existing recipe' })).toHaveAttribute(
    'href',
    /^\/recipes\/[0-9A-Z]{26}$/,
  );
  await banner.getByRole('button', { name: 'Import anyway' }).click();
  await expect(banner).toHaveCount(0);
  await expect(sp.getByRole('button', { name: 'Save imported recipe' })).toBeEnabled();
});

test('failed imports create no recipe and offer paste recovery', async () => {
  for (const path of ['/no-recipe', '/boom']) {
    const before = await recipeCount(seamCtx);
    await importUrl(sp, `${fx}${path}`);
    const alert = sp.getByRole('main').getByRole('alert');
    await expect(alert).toContainText('The recipe could not be imported');
    await expect(alert).toContainText('You can paste the recipe text or the page source instead.');
    await expect(alert).toContainText(
      path === '/boom' ? 'The page could not be fetched.' : 'No recipe was found on this page.',
    );
    await expect(sp.getByLabel('Recipe text or page source')).toBeFocused(); // recovery lands in paste
    expect(await recipeCount(seamCtx)).toBe(before);
  }
});

test('paste fallback: plain text with headings -> review -> save', async () => {
  const before = await recipeCount(seamCtx);
  await importUrl(sp, `${fx}/no-recipe`);
  const paste = sp.getByLabel('Recipe text or page source');
  await expect(paste).toBeFocused();
  await paste.fill(
    'Pasted Porridge\n\nIngredients\n1 cup oats\n2 cups milk\n\nInstructions\nHeat the milk.\nStir in the oats.',
  );
  await sp.getByRole('button', { name: 'Import recipe' }).click();

  await expect(sp.getByLabel('Title', { exact: true })).toHaveValue('Pasted Porridge');
  await expect(sp.getByLabel('Ingredients')).toHaveValue('1 cup oats\n2 cups milk');
  await sp.getByRole('button', { name: 'Save imported recipe' }).click();
  await expect(sp).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(sp.getByRole('heading', { name: 'Pasted Porridge', level: 1 })).toBeVisible();
  await expect(sp.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  expect(await recipeCount(seamCtx)).toBe(before + 1);
});

test('a cover that cannot be downloaded still saves the recipe and shows the notice', async () => {
  await importUrl(sp, `${fx}/bad-cover`);
  await expect(sp.getByLabel('Include the cover image from the source')).toBeChecked();
  const before = await recipeCount(seamCtx);
  await sp.getByRole('button', { name: 'Save imported recipe' }).click();

  await expect(sp).toHaveURL(/\/recipes\/[0-9A-Z]{26}\?notice=cover_failed$/);
  await expect(sp.getByRole('heading', { name: 'Fixture Missing Cover', level: 1 })).toBeVisible();
  await expect(
    sp.getByText('The recipe was saved, but the cover image could not be downloaded.'),
  ).toBeVisible();
  expect(await recipeCount(seamCtx)).toBe(before + 1);
});

test('imported text is rendered as text: script and event-handler markup never runs', async () => {
  await importUrl(sp, `${fx}/hostile`);
  await expect(sp.getByLabel('Title', { exact: true })).toHaveValue('Fixture Hostile Soup');
  await sp.getByRole('button', { name: 'Save imported recipe' }).click();
  await expect(sp).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(sp.getByText('Stir')).toBeVisible();
  expect(await sp.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(sp.locator('main script, main img[src="x"]')).toHaveCount(0);
});

test('loopback and private addresses are refused with the guard on and create no recipe', async ({
  browser,
}) => {
  // BASE has no seam: this is the production SSRF guard.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, me);
  const cases: [string, RegExp][] = [
    ['http://127.0.0.1/', /private or internal/],
    ['http://169.254.169.254/latest/meta-data/', /private or internal/],
    ['http://2130706433/', /private or internal/], // decimal spelling of 127.0.0.1
    [`${BASE}/`, /valid web address/], // non-80/443 port is refused before any lookup
  ];
  for (const [url, message] of cases) {
    const before = await recipeCount(ctx);
    await importUrl(page, url);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(message);
    await expect(page).toHaveURL(/\/import$/);
    expect(await recipeCount(ctx)).toBe(before);
  }
  await ctx.close();
});
