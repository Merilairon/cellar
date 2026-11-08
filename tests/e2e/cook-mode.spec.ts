import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  captureConsole,
  createRecipe,
  hydrated,
  ORIGIN,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';

// T10: cook mode. Overlay (not a route), one history entry, larger text, local checkboxes,
// step = checkbox strip + separate expand button, list recipes, Wake Lock with a stub (the real
// lock is only exercised on the owner's devices).
let ctx: BrowserContext;
// Every test uses a page of the signed-in context created in beforeAll.
const test = base.extend({
  page: async ({}, use) => {
    const p = await ctx.newPage();
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright's fixture callback, not a hook
    await use(p);
    await p.close();
  },
});
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const me = account('cook');
const ids = { grid: '', list: '' };
const GRID_TITLE = SAMPLES.cake.title;
const LIST_TITLE = 'Cook List Soup';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  ctx = await browser.newContext();
  await signIn(await ctx.newPage(), me);
  ids.grid = await createRecipe(ctx, SAMPLES.cake);
  ids.list = await createRecipe(ctx, {
    title: LIST_TITLE,
    visibility: 'private',
    view_mode: 'list',
    sections: [
      {
        title: null,
        ingredients: [
          { name: 'onion', raw_text: '1 onion', display_primary: 'metric' },
          { name: 'stock', raw_text: '500 mL stock', display_primary: 'metric' },
          { name: 'salt', raw_text: 'salt', display_primary: 'metric' },
        ],
        steps: [
          { kind: 'column', label: 'sweat', detail: 'Sweat the onion.' },
          { kind: 'column', label: 'simmer', detail: 'Simmer in the stock.' },
        ],
      },
    ],
  });
});
test.afterAll(async () => {
  for (const id of Object.values(ids)) {
    if (id) await ctx?.request.delete(`/api/recipes/${id}`, { headers: ORIGIN });
  }
  await ctx?.close();
});

const dialog = (p: Page) => p.getByRole('dialog', { name: /^Cooking:/ });
const cookBtn = (p: Page) => p.getByRole('button', { name: 'Cook', exact: true });
const progress = (p: Page) => dialog(p).getByText(/ingredients, \d+ of \d+ steps/);

async function openCook(page: Page, id: string) {
  await page.goto(`/recipes/${id}`);
  await hydrated(cookBtn(page));
  await cookBtn(page).click();
  await expect(dialog(page)).toBeVisible();
}

test('grid recipe: overlay, larger text, checkboxes, expand vs check, no stale checks', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const logs = captureConsole(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/recipes/${ids.grid}`);
  const url = page.url();
  const baseFont = await page
    .locator('main table td')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await hydrated(cookBtn(page));
  await cookBtn(page).click();
  await expect(dialog(page)).toBeVisible();
  expect(page.url()).toBe(url); // an overlay, not a route
  await expect(dialog(page).getByRole('heading', { name: `Cooking: ${GRID_TITLE}` })).toBeFocused();
  const font = await dialog(page)
    .locator('td.rg-step')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(font).toBeGreaterThan(baseFont * 1.3);

  await expect(progress(page)).toHaveText(/^0 of 12 ingredients, 0 of 9 steps$/);
  // Ingredient: the whole label is the target; click on its text.
  await dialog(page).locator('.ck-ing', { hasText: 'unsalted butter' }).first().click();
  await expect(progress(page)).toHaveText(/^1 of 12 ingredients, 0 of 9 steps$/);
  await expect(
    dialog(page)
      .getByRole('checkbox', { name: /unsalted butter/ })
      .first(),
  ).toBeChecked();

  // Step: ticking never expands.
  const cream = dialog(page).getByRole('button', { name: /^cream/ });
  await dialog(page).getByRole('checkbox', { name: 'Mark cream done' }).check();
  await expect(progress(page)).toHaveText(/1 of 9 steps$/);
  await expect(cream).toHaveAttribute('aria-expanded', 'false');
  // Label: expands and never checks.
  await cream.click();
  await expect(cream).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog(page).locator('.rg-panel')).toBeVisible();
  await expect(dialog(page).getByRole('checkbox', { name: 'Mark cream done' })).toBeChecked();
  await expect(progress(page)).toHaveText(/1 of 9 steps$/);
  // The td itself has no click handler under stepTarget="button".
  await dialog(page)
    .locator('td.rg-step')
    .nth(1)
    .evaluate((td) => (td as HTMLElement).click());
  await expect(cream).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog(page).getByRole('button', { name: /^beat in/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  // Toggling does not shift layout.
  const cell = dialog(page).locator('th.rg-ing').first();
  const before = await cell.boundingBox();
  await dialog(page).locator('.ck-ing', { hasText: 'unsalted butter' }).first().click();
  expect(await cell.boundingBox()).toEqual(before);

  // Escape closes the open panel first, the second press closes cook mode.
  await page.keyboard.press('Escape');
  await expect(dialog(page).locator('.rg-panel')).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(cookBtn(page)).toBeFocused();
  expect(page.url()).toBe(url);

  // Reopening starts unchecked (state is not kept).
  await cookBtn(page).click();
  await expect(progress(page)).toHaveText(/^0 of 12 ingredients, 0 of 9 steps$/);
  // The read grid is untouched: the whole cell still expands there.
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await page
    .locator('main td.rg-step')
    .first()
    .click({ position: { x: 3, y: 3 } });
  await expect(page.locator('main .rg-panel')).toBeVisible();

  expect(logs.hydrationMessages()).toEqual([]);
});

test('history: Back closes, Close button leaves no stale entry', async ({ page }) => {
  await page.goto('/recipes');
  await openCook(page, ids.grid);
  const url = page.url();
  await page.goBack();
  await expect(dialog(page)).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(cookBtn(page)).toBeFocused();

  // Visible Close: one close path, and the next Back leaves the recipe page.
  await cookBtn(page).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(cookBtn(page)).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/recipes$/);
});

test('phone: step opens a sheet inside the overlay, Escape closes only the sheet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openCook(page, ids.grid);
  const mix = dialog(page).getByRole('button', { name: /^mix/ });
  // Targets are at least 44 px.
  for (const box of [
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).boundingBox(),
    await dialog(page).getByRole('checkbox', { name: 'Mark mix done' }).locator('..').boundingBox(),
    await mix.boundingBox(),
  ])
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
  await mix.click();
  const sheet = page.getByRole('dialog', { name: /^mix/ });
  await expect(sheet).toBeVisible();
  await expect(dialog(page).getByRole('checkbox', { name: 'Mark mix done' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  await expect(mix).toBeFocused();
  // No horizontal overflow outside the scroll region.
  const overflow = await dialog(page).evaluate((d) => d.scrollWidth - d.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.goBack();
  await expect(dialog(page)).toHaveCount(0);
});

test('list recipe: Cook shows ingredient and step lists with checkboxes', async ({ page }) => {
  await openCook(page, ids.list);
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Ingredients' })).toBeVisible();
  await expect(d.getByRole('heading', { name: 'Steps' })).toBeVisible();
  await expect(progress(page)).toHaveText(/^0 of 3 ingredients, 0 of 2 steps$/);
  await d.locator('.ck-item', { hasText: 'onion' }).first().click();
  await d.locator('.ck-item', { hasText: 'Simmer in the stock.' }).click();
  await expect(progress(page)).toHaveText(/^1 of 3 ingredients, 1 of 2 steps$/);
  await expect(d.getByRole('checkbox', { name: /Simmer in the stock/ })).toBeChecked();
  await d.locator('.ck-item', { hasText: 'Simmer in the stock.' }).click();
  await expect(progress(page)).toHaveText(/^1 of 3 ingredients, 0 of 2 steps$/);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(cookBtn(page)).toBeFocused();
});

test('scale and units are frozen at open and shown', async ({ page }) => {
  await page.goto(`/recipes/${ids.grid}`);
  await hydrated(cookBtn(page));
  await page.getByRole('button', { name: '2x', exact: true }).click();
  await cookBtn(page).click();
  await expect(dialog(page).getByText('Scaled 2x')).toBeVisible();
  await expect(dialog(page).getByText('1 cup', { exact: false }).first()).toBeVisible();
});

const WAKE_STUB = `(() => {
  const w = (window.__wake = { requests: 0, releases: 0, sentinels: [] });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
    request: async () => {
      w.requests += 1;
      const l = [];
      const s = { release: async () => { w.releases += 1; l.forEach((f) => f()); },
        addEventListener: (_t, f) => l.push(f) };
      w.sentinels.push(s);
      return s;
    } } });
})();`;

test('wake lock: requested on enter, re-requested when visible again, released on exit', async ({
  page,
}) => {
  await page.addInitScript(WAKE_STUB);
  await openCook(page, ids.grid);
  await expect(dialog(page).getByText('Screen stays on while you cook.')).toBeVisible();
  const state = () =>
    page.evaluate(() => {
      const w = (window as unknown as { __wake: { requests: number; releases: number } }).__wake;
      return { requests: w.requests, releases: w.releases };
    });
  expect(await state()).toEqual({ requests: 1, releases: 0 });
  // The browser drops the lock when the tab is hidden; coming back asks again.
  await page.evaluate(async () => {
    const w = (window as unknown as { __wake: { sentinels: { release: () => Promise<void> }[] } })
      .__wake;
    await w.sentinels[0].release();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await state()).requests).toBe(2);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await state()).releases).toBe(2);
});

test('wake lock unavailable: one-line hint, everything else works', async ({ page }) => {
  await page.addInitScript(
    `Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });`,
  );
  await openCook(page, ids.grid);
  await expect(dialog(page).getByText(/Your screen may turn off\./)).toBeVisible();
  await dialog(page).locator('.ck-ing', { hasText: 'unsalted butter' }).first().click();
  await expect(progress(page)).toHaveText(/^1 of 12/);
});

test('wake lock rejected: failure hint, never throws', async ({ page }) => {
  const logs = captureConsole(page);
  await page.addInitScript(
    `Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => Promise.reject(new DOMException('no', 'NotAllowedError')) } });`,
  );
  await openCook(page, ids.grid);
  await expect(
    dialog(page).getByText('Could not keep the screen on. It may turn off.'),
  ).toBeVisible();
  expect(logs.all().filter((m) => m.startsWith('pageerror'))).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const w of [375, 1280]) {
    test(`axe: cook mode grid with a step open (${scheme}, ${w})`, async ({ browser }) => {
      const c = await browser.newContext({
        viewport: { width: w, height: 800 },
        colorScheme: scheme,
        reducedMotion: 'reduce',
        storageState: await ctx.storageState(),
      });
      const page = await c.newPage();
      await openCook(page, ids.grid);
      await dialog(page).locator('.ck-ing', { hasText: 'unsalted butter' }).first().click();
      await dialog(page).getByRole('checkbox', { name: 'Mark cream done' }).check();
      await dialog(page)
        .getByRole('button', { name: /^cream/ })
        .click();
      if (w >= 640)
        await expect(dialog(page).getByRole('button', { name: /^cream/ })).toHaveAttribute(
          'aria-expanded',
          'true',
        );
      else await expect(page.getByRole('dialog', { name: /^cream/ })).toBeVisible();
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
      await c.close();
    });
  }
}

test('axe: cook mode list recipe (dark, 375)', async ({ browser }) => {
  const c = await browser.newContext({
    viewport: { width: 375, height: 800 },
    colorScheme: 'dark',
    storageState: await ctx.storageState(),
  });
  const page = await c.newPage();
  await openCook(page, ids.list);
  await dialog(page).locator('.ck-item', { hasText: 'onion' }).first().click();
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
  await c.close();
});
