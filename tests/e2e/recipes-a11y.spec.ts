import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, registerViaInvite, SAMPLES, signIn } from './helpers';

// T15: automated WCAG 2.1 A/AA checks (axe-core) on grid, list and the bottom sheet, in light
// and dark, plus keyboard reachability. Automated checks find roughly a third of issues: the
// screen-reader spot check in T15 stays manual.
test.describe.configure({ mode: 'serial' });

const me = account('a11y');
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
  await page.goto(`/recipes/${id}`);
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  return { page, close: () => ctx.close() };
}

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  // Readable failure: rule, impact and the offending nodes.
  expect(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: grid, inline detail and list (${scheme}, 1280)`, async ({ browser }) => {
    const { page, close } = await open(browser, ids.cake, { w: 1280, h: 800, scheme });
    await expectNoViolations(page);

    await page.getByRole('button', { name: /^cream/ }).click();
    await expect(page.locator('.rg-panel')).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('table.rg-table')).toHaveCount(0);
    await expectNoViolations(page);
    await close();
  });

  test(`axe: phone grid with scroll cue and bottom sheet (${scheme}, 375)`, async ({ browser }) => {
    const { page, close } = await open(browser, ids.cookie, { w: 375, h: 812, scheme });
    await expect(page.locator('.rg-arrow')).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: /^bake/ }).click();
    await expect(page.getByRole('dialog', { name: /bake/ })).toBeVisible();
    await expectNoViolations(page);
    await close();
  });
}

test('table semantics: caption, row headers, hidden column headers, row context', async ({
  browser,
}) => {
  const { page, close } = await open(browser, ids.cookie, { w: 1280, h: 800, scheme: 'light' });
  const table = page.locator('table.rg-table');
  await expect(table.locator('caption')).toHaveText(/ingredients and the steps that use them/);
  await expect(table.locator('thead th[scope="col"]')).toHaveCount(6); // Ingredient + 5 steps
  await expect(table.locator('tbody th[scope="row"]')).toHaveCount(9);
  // A spanning step tells a screen reader which ingredient rows it covers.
  await expect(page.getByRole('button', { name: /^bake.*Uses .+ to .+\./ })).toBeVisible();
  await close();
});

test('keyboard: Tab reaches the scroll region and every step cell; Enter opens detail', async ({
  browser,
}) => {
  for (const [key, id, steps] of [
    ['cookie', ids.cookie, 5],
    ['cake', ids.cake, 7],
  ] as const) {
    const { page, close } = await open(browser, id, { w: 1280, h: 800, scheme: 'light' });
    const expected = await page
      .locator('button[data-step-id]')
      .evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.stepId!));
    expect(expected, key).toHaveLength(steps);

    // Start from the Grid toggle, then Tab forward collecting every focused step button.
    await page.getByRole('button', { name: 'Grid', exact: true }).focus();
    const reached = new Set<string>();
    let sawRegion = false;
    for (let i = 0; i < 40 && reached.size < expected.length; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        return { step: a.dataset.stepId ?? null, region: a.getAttribute('role') === 'region' };
      });
      sawRegion ||= info.region;
      if (info.step) reached.add(info.step);
    }
    expect(sawRegion, `${key}: scroll region is a tab stop`).toBe(true);
    expect([...reached].sort(), `${key}: all step cells reachable`).toEqual([...expected].sort());

    // Focus is not hidden behind the sticky ingredient column.
    const hidden = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      const th = document.querySelector('th.rg-ing') as HTMLElement;
      return a.getBoundingClientRect().left < th.getBoundingClientRect().right - 1;
    });
    expect(hidden, `${key}: focused cell clear of sticky column`).toBe(false);

    await page.keyboard.press('Enter');
    await expect(page.locator('.rg-panel').first()).toBeVisible();
    await close();
  }
});

test('phone: keyboard reaches every cell without it hiding under the sticky column', async ({
  browser,
}) => {
  const { page, close } = await open(browser, ids.cookie, { w: 375, h: 812, scheme: 'light' });
  const n = await page.locator('button[data-step-id]').count();
  await page.locator('.rg-scroller').focus();
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    const clear = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      const th = document.querySelector('th.rg-ing') as HTMLElement;
      const r = a.getBoundingClientRect();
      return r.left >= th.getBoundingClientRect().right - 1 && r.right <= innerWidth + 1;
    });
    expect(clear, `step ${i}`).toBe(true);
  }
  await close();
});

test('bottom sheet: labelled, traps focus, Esc closes, focus returns to the cell', async ({
  browser,
}) => {
  const { page, close } = await open(browser, ids.cookie, { w: 375, h: 812, scheme: 'light' });
  const cell = page.getByRole('button', { name: /^bake/ });
  await cell.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: /bake/ });
  await expect(sheet).toBeVisible();

  // The page behind a modal dialog is inert: Tab/Shift+Tab may land in the dialog or leave the
  // document (browser chrome, activeElement falls back to body) but never on page content.
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(() => {
        const a = document.activeElement;
        return a === document.body || !!a?.closest('dialog');
      }),
      `after ${key}`,
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(cell).toBeFocused();
  await close();
});
