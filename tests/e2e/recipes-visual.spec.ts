import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, registerViaInvite, SAMPLES, signIn } from './helpers';

/**
 * Visual + structural guard for the recipe grid (T16 / G20).
 *
 * BASELINES ARE PLATFORM-SPECIFIC. The PNGs in tests/e2e/__screenshots__/ were generated with
 * the bundled Playwright Chromium on Linux x86_64 (file suffix `-chromium-linux`). Font
 * rasterisation differs on macOS/Windows/arm64, so only regenerate on that platform:
 *   npx playwright test recipes-visual --update-snapshots
 * and review the PNG diff by eye before committing.
 *
 * Determinism: fixed viewport, en-US locale, UTC, reduced motion, animations disabled,
 * a dedicated user with default preferences, fonts awaited, and toHaveScreenshot's own
 * "two identical frames in a row" stabilisation instead of any sleep.
 */
test.describe.configure({ mode: 'serial' });

const WIDTHS = [
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
] as const;

// Sample B guard (v0.2 carryover): the cake and frosting tables share one ingredient column
// width, so the two grids line up. Widths in CSS px at each viewport.
const ING_COL_PX: Record<number, number> = { 375: 138, 768: 190, 1280: 300 };

const me = account('visual');
const ids = { cookie: '', cake: '' };
let setupCtx: BrowserContext;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  setupCtx = await browser.newContext();
  await signIn(await setupCtx.newPage(), me);
  ids.cookie = await createRecipe(setupCtx, SAMPLES.cookie);
  ids.cake = await createRecipe(setupCtx, SAMPLES.cake);
});
test.afterAll(async () => setupCtx?.close());

async function open(
  browser: import('@playwright/test').Browser,
  size: { w: number; h: number },
  recipeId: string,
  colorScheme: 'light' | 'dark' = 'light',
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme,
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(`/recipes/${recipeId}`);
  await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => ctx.close() };
}

const shot = (page: Page, name: string) =>
  expect(page.locator('main')).toHaveScreenshot(name, { animations: 'disabled', caret: 'hide' });

for (const { w, h } of WIDTHS) {
  test(`sample A (skillet cookie) @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, ids.cookie);
    const table = page.locator('table.rg-table');
    // Structure first: a pixel diff alone is a weak guard.
    await expect(table).toHaveCount(1);
    await expect(table.locator('td.rg-banner')).toHaveCount(2);
    await expect(table.locator('tbody th[scope="row"]')).toHaveCount(9);
    const spans = await table
      .locator('td.rg-step')
      .evaluateAll((tds) => tds.map((td) => (td as HTMLTableCellElement).rowSpan));
    expect(spans).toEqual([1, 4, 5, 9, 9]);
    await shot(page, `cookie-${w}.png`);
    await close();
  });

  test(`sample B (cake + frosting) @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, ids.cake);
    const tables = page.locator('table.rg-table');
    await expect(tables).toHaveCount(2);
    // Cake has 1 top banner; frosting has the single bottom banner (last row of its table).
    await expect(tables.nth(0).locator('td.rg-banner')).toHaveCount(1);
    await expect(tables.nth(1).locator('td.rg-banner')).toHaveCount(1);
    await expect(tables.nth(1).locator('tbody tr').last().locator('td.rg-banner')).toHaveCount(1);
    // The split sugar pair is two ingredient rows in the cake table.
    await expect(tables.nth(0).locator('tbody th[scope="row"]', { hasText: 'sugar' })).toHaveCount(
      2,
    );
    await expect(tables.nth(0).locator('tbody th[scope="row"]')).toHaveCount(8);
    await expect(tables.nth(1).locator('tbody th[scope="row"]')).toHaveCount(4);
    const ingWidths = await tables.evaluateAll((ts) =>
      ts.map((t) => {
        const th = t.querySelector('tbody th.rg-ing');
        return th ? Math.round(th.getBoundingClientRect().width) : -1;
      }),
    );
    expect(ingWidths).toEqual([ING_COL_PX[w], ING_COL_PX[w]]);
    await shot(page, `cake-${w}.png`);
    await close();
  });
}

// Dark palette is separate CSS; one phone and one desktop baseline each keeps it honest.
for (const { w, h } of [WIDTHS[0], WIDTHS[2]]) {
  test(`dark theme @${w}`, async ({ browser }) => {
    const { page, close } = await open(browser, { w, h }, ids.cookie, 'dark');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    await shot(page, `cookie-${w}-dark.png`);
    await close();
  });
}

test('375px: scroll cue, sticky ingredient column, tap opens bottom sheet', async ({ browser }) => {
  const { page, close } = await open(browser, { w: 375, h: 812 }, ids.cookie);
  const scroller = page.locator('.rg-scroller');
  await expect(page.locator('.rg-arrow')).toBeVisible(); // columns are hidden off-screen

  const stickyLeft = () =>
    page
      .locator('tbody th.rg-ing')
      .first()
      .evaluate((el) => el.getBoundingClientRect().left);
  const before = await stickyLeft();
  await scroller.evaluate((el) => (el.scrollLeft = 120));
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await stickyLeft()).toBeCloseTo(before, 0); // pinned while content moved

  await page.getByRole('button', { name: /^bake/ }).click();
  const sheet = page.getByRole('dialog', { name: /bake/ });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Bake until the edges are set');
  await close();
});
