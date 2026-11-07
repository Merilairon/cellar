import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  captureConsole,
  createRecipe,
  hydrated,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';

// T4: the editor shell and edit-mode table. axe (WCAG 2.1 A/AA) in light and dark at phone and
// desktop widths, the single-tab-stop roving model, and the entry / exit behaviour. Token
// contrast pairs are re-checked for the whole editor in T12.
test.describe.configure({ mode: 'serial' });

const me = account('geshell');
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
  browser: Browser,
  id: string,
  { w, h, scheme }: { w: number; h: number; scheme: 'light' | 'dark' },
) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    colorScheme: scheme,
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  const console_ = captureConsole(page);
  await page.goto(`/recipes/${id}`);
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const entry = page.getByRole('button', { name: 'Edit grid' });
  await hydrated(entry);
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  return { page, console: console_, close: () => ctx.close() };
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

for (const scheme of ['light', 'dark'] as const) {
  for (const [w, h] of [
    [1280, 800],
    [375, 812],
  ] as const) {
    test(`axe: editor shell on the multi-section sample (${scheme}, ${w})`, async ({ browser }) => {
      const { page, close } = await open(browser, ids.cake, { w, h, scheme });
      await expectNoViolations(page);
      // A selected step shows the covered-row highlight; check that state too.
      await page
        .getByRole('button', { name: /^Step 1:/ })
        .first()
        .click();
      await expect(page.locator('th.ge-ing[data-covered="true"]').first()).toBeVisible();
      await expectNoViolations(page);
      await close();
    });
  }
}

test('entry: owner sees Edit grid, read-view controls are hidden while editing, Done restores', async ({
  browser,
}) => {
  const { page, close } = await open(browser, ids.cookie, { w: 1280, h: 800, scheme: 'light' });
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveCount(0);
  await expect(page.getByText('Showing quantities as written')).toBeVisible();
  await expect(page.locator('table.rg-table.ge-table')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).click(); // clean: no prompt
  await expect(page.getByRole('button', { name: 'Edit grid' })).toBeFocused();
  await expect(page.locator('table.ge-table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toBeVisible();
  await close();
});

test('roving tabindex: one tab stop per table, arrows walk, Ctrl+Home / End', async ({
  browser,
}) => {
  const {
    page,
    console: errors,
    close,
  } = await open(browser, ids.cake, {
    w: 1280,
    h: 800,
    scheme: 'light',
  });
  const tables = await page.locator('table.ge-table').count();
  expect(tables).toBeGreaterThan(1);
  expect(await page.locator('[data-ge-target][tabindex="0"]').count()).toBe(tables);

  const first = page.locator('table.ge-table').first().locator('[data-ge-target][tabindex="0"]');
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-ge-target]:focus')).toContainText('Row 2 of');
  // The tab stop followed the focus.
  await expect(
    page.locator('table.ge-table').first().locator('[data-ge-target][tabindex="0"]'),
  ).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(page.locator('table.ge-table').nth(1).locator('[data-ge-target]:focus')).toHaveCount(
    1,
  );
  await page.keyboard.press('Control+End');
  await expect(page.locator('[data-ge-target]:focus')).toHaveCount(1);
  expect(errors.all()).toEqual([]);
  await close();
});
