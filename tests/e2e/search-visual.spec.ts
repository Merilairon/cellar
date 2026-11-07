import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

/**
 * Visual baselines for the 04a UI (T12): /recipes with search + tag chips, and the recipe page
 * with tag chips and the scale/unit controls. Baselines are generated ONLY in the pinned
 * Playwright image via scripts/update-visual-baselines.sh (see playwright.config.ts); a host
 * run will differ in font rasterisation. Determinism: fixed viewport, en-US, UTC, reduced
 * motion, fonts awaited, and the "Updated <date>" lines masked (they change daily).
 */
test.describe.configure({ mode: 'serial' });

const WIDTHS = [
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
] as const;

const me = account('vivian');
let setupCtx: BrowserContext;
let cookieId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  setupCtx = await browser.newContext();
  await signIn(await setupCtx.newPage(), me);
  cookieId = await createRecipe(setupCtx, { ...SAMPLES.cookie, tags: ['coffee', 'dessert'] });
  await createRecipe(setupCtx, { ...SAMPLES.cake, tags: ['dessert', 'party'] });
});
test.afterAll(async () => setupCtx?.close());

async function open(browser: Browser, size: { w: number; h: number }, path: string) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(path);
  await hydrated(page.getByRole('searchbox', { name: 'Search recipes' }));
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => ctx.close() };
}

const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    mask: [page.getByText(/^Updated /)],
  });

for (const { w, h } of WIDTHS) {
  test(`recipes list with search and tag chips @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, '/recipes?q=frosting');
    await expect(page.getByRole('searchbox', { name: 'Search recipes' })).toHaveValue('frosting');
    await expect(page.getByRole('navigation', { name: 'Filter by tag' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveCount(1);
    await shot(page, `list-search-${w}.png`);
    await close();
  });

  test(`recipes list with an active tag chip @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, '/recipes?tag=dessert');
    await expect(page.getByRole('link', { name: /^dessert,.*Filter active/ })).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveCount(2);
    await shot(page, `list-tag-${w}.png`);
    await close();
  });

  test(`recipe page tag chips and scale controls @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, `/recipes/${cookieId}`);
    await expect(page.getByRole('list', { name: 'Tags', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await shot(page, `recipe-controls-${w}.png`);

    await page.getByRole('button', { name: '2x', exact: true }).click();
    await page.getByRole('button', { name: 'Show in US units' }).click();
    await expect(page.locator('.rg-qty', { hasText: '8 oz (230 g)' })).toHaveCount(1);
    await shot(page, `recipe-controls-2x-us-${w}.png`);
    await close();
  });
}
