import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

/**
 * Visual baselines for the grid editor (v0.4.1 T13) on the Mocha Skillet Cookie at 375 / 768 /
 * 1280. Baselines are generated ONLY in the pinned Playwright image via
 * scripts/update-visual-baselines.sh (see playwright.config.ts); a host run differs in font
 * rasterisation. Determinism: fixed viewport, en-US, UTC, reduced motion, fonts awaited, the
 * "Updated <date>" lines masked. Nothing here saves: the recipe is only edited in memory.
 */
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const WIDTHS = [
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
] as const;

const me = account('gevisual');
let setupCtx: BrowserContext;
let cookieId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  setupCtx = await browser.newContext();
  await signIn(await setupCtx.newPage(), me);
  cookieId = await createRecipe(setupCtx, SAMPLES.cookie);
});
test.afterAll(async () => setupCtx?.close());

async function open(
  browser: Browser,
  size: { w: number; h: number },
  scheme: 'light' | 'dark' = 'light',
) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: scheme,
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(`/recipes/${cookieId}`);
  const entry = page.getByRole('button', { name: 'Edit grid' });
  await hydrated(entry);
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => ctx.close() };
}

// Playwright's `fullPage` capture flickers the emulated viewport, which flips the phone media
// query for a moment and resets editor state (the Adjust rows disclosure closes) at random, and
// it paints a sticky bar mid-page. So a tall page is captured by making the viewport as tall as
// the document first and taking an ordinary viewport screenshot. The sheets are viewport shots.
const shot = async (page: Page, name: string, fullPage = true) => {
  if (fullPage) {
    const width = page.viewportSize()!.width;
    for (let i = 0; i < 2; i++) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width, height });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  // Park the pointer in the corner so no button keeps a hover background from the last click.
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.getByText(/^Updated /)],
  });
};

/** No horizontal page overflow outside the grid's own scroll region (T13 acceptance). */
async function noPageOverflow(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const { w, h } of WIDTHS) {
  const phone = w < 640;

  test(`editor idle @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h });
    await noPageOverflow(page);
    await shot(page, `idle-${w}.png`);
    await close();
  });

  test(`editor selected step @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h });
    await page.locator('[data-ge-target^="step:"]').first().click();
    if (phone) {
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Start row' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'End row' })).toBeVisible();
      await shot(page, `step-selected-${w}.png`, false);
    } else {
      await expect(page.locator('[data-ge-panel]')).toBeVisible();
      await shot(page, `step-selected-${w}.png`);
    }
    await noPageOverflow(page);
    await close();
  });

  if (!phone) {
    test(`editor adjust rows @${w}`, async ({ browser }) => {
      const { page, close } = await open(browser, { w, h });
      await page.locator('[data-ge-target^="step:"]').first().click();
      await page.getByRole('button', { name: 'Adjust rows' }).click();
      await expect(page.getByRole('group', { name: 'Start row' })).toBeVisible();
      await shot(page, `adjust-rows-${w}.png`);
      await close();
    });
  } else {
    test(`editor row sheet @${w}`, async ({ browser }) => {
      const { page, close } = await open(browser, { w, h });
      await page
        .getByRole('button', { name: /^Row actions for/ })
        .first()
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `row-sheet-${w}.png`, false);
      await close();
    });

    test(`editor row sheet, last row @${w}`, async ({ browser }) => {
      const { page, close } = await open(browser, { w, h });
      const last = page.getByRole('button', { name: /^Row actions for/ }).last();
      await last.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await last.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `row-sheet-last-${w}.png`, false);
      await close();
    });
  }

  test(`editor conflict panel @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h });
    await page.route('**/api/recipes/*/grid', (r) =>
      r.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ updated_at: '2026-11-07T12:00:00.000Z' }),
      }),
    );
    // Make the form dirty so Save is available.
    await page.locator('[data-ge-target^="row:"]').first().focus();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'Edit ingredient 1' }).fill('6 oz unsalted butter');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Save changes/ }).click();
    await expect(
      page.getByRole('heading', { name: 'This recipe changed while you were editing.' }),
    ).toBeFocused();
    await shot(page, `conflict-${w}.png`);
    await close();
  });

  test(`editor issues panel @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h });
    const lastMenu = page.getByRole('button', { name: /^Row actions for/ }).last();
    await lastMenu.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await lastMenu.click();
    await page.getByRole(phone ? 'button' : 'menuitem', { name: 'Add row below' }).click();
    await page.keyboard.type('1 tsp warning salt');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/No step covers/).first()).toBeVisible();
    await shot(page, `issues-${w}.png`);
    await close();
  });
}

// Dark palette is separate CSS: idle at both extremes, plus the states most likely to differ.
for (const { w, h } of [WIDTHS[0], WIDTHS[2]]) {
  test(`editor idle, dark @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, 'dark');
    await shot(page, `idle-${w}-dark.png`);
    await close();
  });

  test(`editor selected step, dark @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, 'dark');
    await page.locator('[data-ge-target^="step:"]').first().click();
    if (w < 640) {
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `step-selected-${w}-dark.png`, false);
    } else {
      await expect(page.locator('[data-ge-panel]')).toBeVisible();
      await shot(page, `step-selected-${w}-dark.png`);
    }
    await close();
  });
}
