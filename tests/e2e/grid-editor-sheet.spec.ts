import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

// T8: phone (375 x 667) bottom sheet with Start / End steppers and the Row actions sheet.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gesheet');
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
    viewport: { width, height: 667 },
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

test('phone: step sheet steppers, live highlight, focus and Escape', async ({ browser }) => {
  const { page, close } = await openEditor(browser, 375);
  const stepBtn = page.locator('[data-ge-target^="step:"]').first();
  // A step cell holds exactly one visible control: the step button (no handles at phone).
  const cell = page.locator('td.ge-step').first();
  expect(await cell.locator('button:visible, [role="slider"]:visible').count()).toBe(1);

  await stepBtn.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { level: 4 })).toBeFocused();
  // The step details stay closed, so no text field (and no keyboard) is shown.
  await expect(sheet.getByRole('textbox')).toHaveCount(0);
  const box = await sheet.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(667 * 0.55 + 1);

  const covered = sheet.locator('[data-ge-covered] li');
  const highlighted = page.locator('th.ge-ing[data-covered="true"]');
  const before = await covered.count();
  const hBefore = await highlighted.count();
  const endPlus = sheet.getByRole('button', { name: /end one row later/ });
  const endMinus = sheet.getByRole('button', { name: /end one row earlier/ });
  expect((await endPlus.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await endPlus.click();
  await expect(covered).toHaveCount(before + 1);
  await expect(highlighted).toHaveCount(hBefore + 1);
  await endMinus.click();
  await expect(covered).toHaveCount(before);

  // Start at row 1: "earlier" is aria-disabled, stays focusable, announces why.
  const startMinus = sheet.getByRole('button', { name: /start one row earlier/ });
  await expect(startMinus).toHaveAttribute('aria-disabled', 'true');
  await startMinus.click({ force: true });
  await expect(page.getByRole('status')).toContainText('already starts at row 1');

  const axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(stepBtn).toBeFocused();
  await close();
});

test('phone: Row actions opens a sheet; Move down works from it', async ({ browser }) => {
  const { page, close } = await openEditor(browser, 375);
  const first = page.locator('[data-ge-target^="row:"]').first();
  const second = page.locator('[data-ge-target^="row:"]').nth(1);
  const firstName = (await first.innerText()).replace(/^Row 1 of \d+: /, '');
  const btn = page.getByRole('button', { name: /^Row actions for/ }).first();
  await btn.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await sheet.getByRole('button', { name: /^Move .* down$/ }).click();
  await expect(sheet).toBeHidden();
  await expect(second).toContainText(firstName.split(' ').pop()!);
  await close();
});

test('tablet 800: Row actions stays a menu and Adjust rows is inline', async ({ browser }) => {
  const { page, close } = await openEditor(browser, 800);
  await page
    .getByRole('button', { name: /^Row actions for/ })
    .first()
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-ge-target^="step:"]').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Adjust rows' }).click();
  await expect(page.getByRole('group', { name: 'Start row' })).toBeVisible();
  await close();
});
