import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  createRecipe,
  hydrated,
  ORIGIN,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';
import { apiUpload, expectLoaded, makeImage, SVG_AS_JPG } from './media-support';

/**
 * T15: visual baselines for the v0.4.2 surfaces (cover card and page, photo manager, notes,
 * rating, min-rating filter, cook mode). Baselines are generated ONLY in the pinned Playwright
 * image (scripts/update-visual-baselines.sh) and every PNG is reviewed by eye.
 */
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const me = account('mediavis');
const ids = { photo: '', bare: '' };
let setupCtx: BrowserContext;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  setupCtx = await browser.newContext();
  await signIn(await setupCtx.newPage(), me);
  ids.photo = await createRecipe(setupCtx, { ...SAMPLES.cake, title: 'Visual Photo Cake' });
  ids.bare = await createRecipe(setupCtx, { ...SAMPLES.cookie, title: 'Visual Bare Cookie' });
  for (const [i, c] of [
    { r: 214, g: 140, b: 60 },
    { r: 70, g: 130, b: 190 },
  ].entries()) {
    const res = await apiUpload(setupCtx, ids.photo, await makeImage('jpeg', c), 'image/jpeg');
    expect(res.status(), `photo ${i}`).toBe(201);
  }
  const post = (body: string, shared: boolean) =>
    setupCtx.request.post(`/api/recipes/${ids.photo}/notes`, {
      headers: ORIGIN,
      data: { body, shared },
    });
  expect((await post('Private: use less sugar next time.', false)).status()).toBe(201);
  expect((await post('Shared: great with berries.', true)).status()).toBe(201);
  const rate = await setupCtx.request.put(`/api/recipes/${ids.photo}/rating`, {
    headers: ORIGIN,
    data: { stars: 4 },
  });
  expect(rate.ok()).toBe(true);
});
test.afterAll(async () => {
  for (const id of Object.values(ids)) {
    if (id) await setupCtx?.request.delete(`/api/recipes/${id}`, { headers: ORIGIN });
  }
  await setupCtx?.close();
});

const SIZES = [
  { w: 375, h: 812 },
  { w: 1280, h: 800 },
] as const;

async function open(
  browser: Browser,
  size: { w: number; h: number },
  path: string,
  colorScheme: 'light' | 'dark' = 'light',
) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme,
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => ctx.close() };
}

const dates = (p: Page) => [p.getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/)];
const shot = (page: Page, name: string, target = page.locator('main')) =>
  expect(target).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    mask: dates(page),
  });

async function noOverflow(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const size of SIZES) {
  test(`list: card with cover and rating, card without, min-rating chip @${size.w}`, async ({
    browser,
  }) => {
    const { page, close } = await open(browser, size, '/recipes');
    await hydrated(page.getByRole('searchbox', { name: 'Search recipes' }));
    const thumb = page.getByRole('main').locator('img').first();
    await expectLoaded(thumb);
    await noOverflow(page);
    await shot(page, `list-cards-${size.w}.png`);
    await page.goto('/recipes?min_rating=3');
    await expectLoaded(page.getByRole('main').locator('img').first());
    await expect(page.getByRole('link', { name: '3 stars or more' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await shot(page, `list-min-rating-${size.w}.png`);
    await page.goto('/recipes?min_rating=5');
    await expect(page.getByRole('heading', { name: 'No recipes found' })).toBeVisible();
    await shot(page, `list-min-rating-empty-${size.w}.png`);
    await close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`recipe page: cover, rating, notes (${scheme}) @${size.w}`, async ({ browser }) => {
      const { page, close } = await open(browser, size, `/recipes/${ids.photo}`, scheme);
      await expectLoaded(page.getByRole('img', { name: /^Photo of Visual Photo Cake/ }));
      await hydrated(page.getByLabel('Add a note'));
      await expect(page.getByRole('radio', { name: '4 of 5 stars' })).toBeChecked();
      await noOverflow(page);
      await shot(page, `page-media-${scheme}-${size.w}.png`);
      await close();
    });
  }

  test(`photo manager: photos, cover badge, upload errors, delete confirm @${size.w}`, async ({
    browser,
  }) => {
    const { page, close } = await open(browser, size, `/recipes/${ids.photo}`);
    const toggle = page.getByRole('button', { name: 'Edit photos' }).first();
    await hydrated(toggle);
    await toggle.click();
    await expect(page.getByRole('heading', { name: 'Photos (2 of 10)' })).toBeVisible();
    for (const img of await page.getByRole('main').locator('[data-tile] img').all())
      await expectLoaded(img);
    const manager = page
      .getByRole('heading', { name: /^Photos \(/ })
      .locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await shot(page, `photo-manager-${size.w}.png`, manager);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'evil.jpg',
      mimeType: 'image/jpeg',
      buffer: SVG_AS_JPG,
    });
    await expect(page.getByText(/Problem: evil\.jpg is not a supported image/)).toBeVisible();
    await page.getByRole('button', { name: /^Delete \(Photo 2 of 2\)/ }).click();
    await expect(page.getByText('Delete this photo? This cannot be undone.')).toBeVisible();
    await noOverflow(page);
    await shot(page, `photo-manager-errors-${size.w}.png`, manager);
    await close();
  });

  test(`recipe page without photo: empty placeholder @${size.w}`, async ({ browser }) => {
    const { page, close } = await open(browser, size, `/recipes/${ids.bare}`);
    await expect(page.getByText('No photo yet')).toBeVisible();
    await noOverflow(page);
    await shot(page, `page-bare-${size.w}.png`);
    await close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`cook mode: unchecked and checked (${scheme}) @${size.w}`, async ({ browser }) => {
      const { page, close } = await open(browser, size, `/recipes/${ids.photo}`, scheme);
      const cook = page.getByRole('button', { name: 'Cook', exact: true });
      await hydrated(cook);
      await cook.click();
      const dlg = page.getByRole('dialog', { name: /^Cooking:/ });
      await expect(dlg).toBeVisible();
      await expect(dlg).toHaveScreenshot(`cook-unchecked-${scheme}-${size.w}.png`, {
        animations: 'disabled',
        caret: 'hide',
      });
      await dlg.locator('.ck-ing').nth(0).click();
      await dlg.locator('.ck-ing').nth(1).click();
      await expect(dlg.getByRole('checkbox', { checked: true })).toHaveCount(2);
      await expect(dlg).toHaveScreenshot(`cook-checked-${scheme}-${size.w}.png`, {
        animations: 'disabled',
        caret: 'hide',
      });
      await close();
    });
  }
}

test('rating control states: unrated and rated (light, dark) @375', async ({ browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const { page, close } = await open(browser, { w: 375, h: 812 }, `/recipes/${ids.bare}`, scheme);
    const group = page.getByRole('radiogroup', { name: 'Your rating' });
    await hydrated(group.getByRole('radio').first());
    const panel = group.locator('xpath=ancestor::div[3]');
    await shot(page, `rating-unrated-${scheme}.png`, panel);
    await group.getByRole('radio', { name: '3 of 5 stars' }).focus();
    await page.keyboard.press('ArrowRight'); // keyboard selection shows focus ring + value text
    await expect(page.getByText('Your rating is 4 of 5 stars.')).toBeVisible();
    await shot(page, `rating-rated-focus-${scheme}.png`, panel);
    await page.getByRole('button', { name: 'Clear my rating' }).click();
    await expect(page.getByText('Your rating was cleared.')).toBeVisible();
    await close();
  }
});
