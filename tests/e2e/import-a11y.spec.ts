import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { account, registerViaInvite, signIn } from './helpers';

/**
 * T13: axe (WCAG 2.1 A/AA incl. color-contrast) on every state added in v0.3.0 (import page URL
 * and paste tabs, progress, error, review screen with duplicate banner and warnings, cover_failed
 * notice), light and dark, 375 and 1280 px, plus a keyboard-only pass of the import dialog.
 * Runs against the SEAM dev server (:3101), like import.spec.ts.
 */
test.describe.configure({ mode: 'serial' });

const SEAM = 'http://localhost:3101';
const me = account('impa11y');
let fixtures: Server;
let fx = '';
let setupCtx: BrowserContext;

// No times and an unparseable yield trigger the review warnings.
const recipePage = (name: string, image: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${name}</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name,
  image,
  recipeYield: 'a few',
  recipeCategory: 'Dessert',
  recipeIngredient: ['2 cups flour', '1 cup sugar', 'a pinch of salt'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Mix and bake.' }],
})}</script></head><body><h1>${name}</h1></body></html>`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  fixtures = createServer((req, res) => {
    if (req.url === '/warn' || req.url === '/bad-cover') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      // Nothing listens on :1, so the cover download fails after the recipe is saved.
      return res.end(
        recipePage(
          req.url === '/warn' ? 'A11y Warning Cake' : 'A11y Missing Cover',
          req.url === '/warn' ? 'https://127.0.0.1:1/cover.png' : 'https://127.0.0.1:1/nope.png',
        ),
      );
    }
    if (req.url === '/no-recipe') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>Blog</title><p>Just a story.</p>');
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((ok) => fixtures.listen(0, '127.0.0.1', ok));
  fx = `http://127.0.0.1:${(fixtures.address() as AddressInfo).port}`;
  setupCtx = await browser.newContext({ baseURL: SEAM });
  await signIn(await setupCtx.newPage(), me);
});
test.afterAll(async () => {
  await setupCtx?.close();
  await new Promise((ok) => fixtures?.close(ok));
});

async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))))
    .toBe(true);
}

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

async function open(browser: Browser, scheme: 'light' | 'dark', width: number) {
  const ctx = await browser.newContext({
    baseURL: SEAM,
    viewport: { width, height: 900 },
    colorScheme: scheme,
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  return { ctx, page: await ctx.newPage() };
}

async function importUrl(page: Page, url: string) {
  await page.goto('/import');
  await hydrated(page.getByLabel('Recipe web address'));
  await page.getByLabel('Recipe web address').fill(url);
  await page.getByRole('button', { name: 'Import recipe' }).click();
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`axe: import dialog, progress, error, review, duplicate, notice (${scheme}, ${width})`, async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const { ctx, page } = await open(browser, scheme, width);

      // URL tab and paste tab.
      await page.goto('/import');
      await hydrated(page.getByLabel('Recipe web address'));
      await expectNoViolations(page);
      await page.getByRole('tab', { name: 'Paste the recipe' }).click();
      await expect(page.getByLabel('Recipe text or page source')).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole('tab', { name: 'From a web address' }).click();

      // Progress state: hold the request open.
      let release!: () => void;
      const gate = new Promise<void>((ok) => (release = ok));
      await page.route('**/api/import', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await gate;
        await route.continue();
      });
      await page.getByLabel('Recipe web address').fill(`${fx}/no-recipe`);
      await page.getByRole('button', { name: 'Import recipe' }).click();
      await expect(page.getByRole('progressbar')).toBeVisible();
      await expect(page.getByText(/Fetching the page|Reading the recipe/).first()).toBeVisible();
      await expectNoViolations(page);
      release();

      // Error state (lands in paste tab).
      const alert = page.getByRole('main').getByRole('alert');
      await expect(alert).toContainText('The recipe could not be imported');
      await expectNoViolations(page);
      await page.unroute('**/api/import');

      // Review screen with warnings and cover checkbox.
      await importUrl(page, `${fx}/warn`);
      await expect(page.getByRole('heading', { name: 'Review the imported recipe' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Things to check' })).toBeVisible();
      await expectNoViolations(page);

      // Save, then import again for the duplicate banner.
      await page.getByRole('button', { name: 'Save imported recipe' }).click();
      await expect(page).toHaveURL(/\/recipes\/[0-9A-Z]{26}/);
      await importUrl(page, `${fx}/warn`);
      await expect(
        page.getByRole('status').filter({ hasText: 'You already have a recipe' }),
      ).toBeVisible();
      await expectNoViolations(page);

      // cover_failed notice on the recipe page.
      await importUrl(page, `${fx}/bad-cover`);
      await page.getByRole('button', { name: 'Save imported recipe' }).click();
      await expect(page).toHaveURL(/notice=cover_failed$/);
      await expect(page.getByText('the cover image could not be downloaded')).toBeVisible();
      await expectNoViolations(page);
      await ctx.close();
    });
  }
}

test('keyboard only: import dialog tab order, tab arrows, focus after failure, submit by Enter', async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, 'light', 1280);
  await page.goto('/import');
  const url = page.getByLabel('Recipe web address');
  await hydrated(url);

  const focusedName = () =>
    page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      return e
        ? `${e.tagName}:${e.getAttribute('role') ?? ''}:${e.id}:${e.textContent?.slice(0, 20) ?? ''}`
        : '';
    });
  // Tab order inside the form (after the app header links): tab -> input -> submit.
  await page.getByRole('tab', { name: 'From a web address' }).focus();
  await page.keyboard.press('Tab');
  await expect(url).toBeFocused(); // inactive tab has tabindex -1, so it is skipped
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Import recipe' })).toBeFocused();
  await page.keyboard.press('Tab'); // leaves the form; no trap
  expect(await focusedName()).not.toContain('import-url');

  // Arrow keys move selection and focus between tabs.
  await page.getByRole('tab', { name: 'From a web address' }).focus();
  await page.keyboard.press('ArrowRight');
  const paste = page.getByRole('tab', { name: 'Paste the recipe' });
  await expect(paste).toBeFocused();
  await expect(paste).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'From a web address' })).toBeFocused();

  // Enter in the URL field submits; a failure is announced in role=alert and focus moves to paste.
  await url.focus();
  await page.keyboard.type(`${fx}/no-recipe`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not be imported');
  await expect(page.getByLabel('Recipe text or page source')).toBeFocused();

  // Esc: the import form is a page, not a modal, so Esc is a no-op (nothing to close or trap).
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Recipe text or page source')).toBeFocused();
  await ctx.close();
});
