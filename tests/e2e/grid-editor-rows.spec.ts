import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  createRecipe,
  hydrated,
  registerViaInvite,
  SAMPLES,
  signIn,
  scrollSettled,
} from './helpers';

// T5 / T7: ingredient row actions and sections in the grid editor, keyboard and mouse.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gerows');
let setupCtx: BrowserContext;
let cakeId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  setupCtx = await browser.newContext();
  await signIn(await setupCtx.newPage(), me);
  cakeId = await createRecipe(setupCtx, SAMPLES.cake);
});
test.afterAll(async () => setupCtx?.close());

async function openEditor(browser: import('@playwright/test').Browser, width: number) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(`/recipes/${cakeId}`);
  const entry = page.getByRole('button', { name: 'Edit grid' });
  await hydrated(entry);
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  return { page, close: () => ctx.close() };
}

const firstRow = (page: Page) => page.locator('[data-ge-target^="row:"]').first();

test('desktop: inline Move buttons exist and Alt+ArrowDown moves a row', async ({ browser }) => {
  const { page, close } = await openEditor(browser, 1280);
  const first = firstRow(page);
  const name = (await first.innerText()).replace(/^Row 1 of \d+: /, '');
  await expect(page.locator('[data-ge-act="moveDown"]').first()).toBeVisible();
  await first.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByRole('status').filter({ hasText: 'moved to row 2' })).toHaveCount(1);
  await expect(page.locator('[data-ge-target^="row:"]').nth(1)).toBeFocused();
  await expect(page.locator('[data-ge-target^="row:"]').nth(1)).toContainText(
    name.split(' ').pop()!,
  );
  await page.keyboard.press('Control+z');
  await expect(first).toContainText(name.split(' ').pop()!);
  await close();
});

test('tablet: no inline Move buttons, Row actions menu offers them', async ({ browser }) => {
  const { page, close } = await openEditor(browser, 800);
  await expect(page.locator('[data-ge-act="moveDown"]').first()).toBeHidden();
  const rowActions = page.getByRole('button', { name: /^Row actions for/ }).first();
  await scrollSettled(rowActions);
  await rowActions.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Edit text' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: /^Move .* down$/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Split into portions' })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: /^Row actions for/ }).first()).toBeFocused();
  await close();
});

test('edit text, add, split, delete with Undo toast', async ({ browser }) => {
  const { page, close } = await openEditor(browser, 1280);
  const rows = page.locator('[data-ge-target^="row:"]');
  const before = await rows.count();
  const chips = page.getByText(/^Portion \d of \d$/);
  const chipsBefore = await chips.count();

  await rows.first().focus();
  await page.keyboard.press('F2');
  const field = page.getByRole('textbox', { name: 'Edit ingredient 1' });
  await expect(field).toBeFocused();
  await field.fill('6 oz unsalted butter');
  await expect(page.getByText(/Parsed as: .*unsalted butter/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(rows.first()).toContainText('unsalted butter');
  await expect(rows.first()).toBeFocused();

  // Escape cancels with no change.
  await rows.first().focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Edit ingredient 1' }).fill('nonsense');
  await page.keyboard.press('Escape');
  await expect(rows.first()).toContainText('unsalted butter');

  // Add row below, committing empty text removes it again.
  await page
    .getByRole('button', { name: /^Row actions for/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Add row below' }).click();
  await expect(page.getByRole('textbox', { name: 'Edit ingredient 2' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(before);

  // Split into portions: chips and a focused label field.
  await page
    .getByRole('button', { name: /^Row actions for/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Split into portions' }).click();
  await expect(page.getByRole('textbox', { name: /^Portion label for/ })).toBeFocused();
  await page.keyboard.type('later');
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(before + 1);
  await expect(chips).toHaveCount(chipsBefore + 2);

  // Delete shows the Undo toast; Undo restores the row.
  await rows.first().focus();
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(before);
  const toast = page.locator('[data-ge-toast]');
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(rows).toHaveCount(before + 1);
  await close();
});

test('sections: add, rename (empty rejected), delete with confirm and Undo', async ({
  browser,
}) => {
  const { page, close } = await openEditor(browser, 1280);
  const headings = page.locator('[data-ge-heading]');
  await expect(headings).toHaveCount(2);

  await page.getByRole('button', { name: 'Add section' }).click();
  await expect(headings).toHaveCount(3);
  // F5: the new section opens its rename field at once.
  const field = page.getByRole('textbox', { name: 'Section name' });
  await expect(field).toBeFocused();
  await field.fill('');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Give each section a name.')).toBeVisible();
  await field.fill('Glaze');
  await page.keyboard.press('Enter');
  await expect(headings.nth(2)).toHaveText('Glaze');

  // F14: emptying an existing name and leaving the field keeps it open with the message.
  await page.getByRole('button', { name: 'Rename' }).nth(2).click();
  await field.fill('');
  await page.getByRole('button', { name: 'Add section' }).focus();
  await expect(page.getByText('Give each section a name.')).toBeVisible();
  await expect(field).toBeVisible();
  await field.fill('Glaze');
  await page.keyboard.press('Enter');
  await expect(headings.nth(2)).toHaveText('Glaze');

  // Empty section deletes at once (toast); a section with content asks first.
  await page.getByRole('button', { name: 'Delete section' }).nth(2).click();
  await expect(headings).toHaveCount(2);
  await page.locator('[data-ge-toast]').getByRole('button', { name: 'Undo' }).click();
  await expect(headings).toHaveCount(3);

  await page.getByRole('button', { name: 'Delete section' }).first().click();
  await expect(page.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(headings).toHaveCount(3);
  await page.getByRole('button', { name: 'Delete section' }).first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(headings).toHaveCount(2);
  await close();
});
