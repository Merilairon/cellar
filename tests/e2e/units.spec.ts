import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

// T12 units and scaling on the recipe page. The sample stores "4 oz (115 g) unsalted butter"
// (display_primary us) and "2 large eggs". New accounts default to the metric preference.
// Order matters inside this file: the profile preference is switched to US in the last tests.
test.describe.configure({ mode: 'serial' });

const me = account('uma');
let ctx: BrowserContext;
let page: Page;
let id = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await signIn(page, me);
  id = await createRecipe(ctx, SAMPLES.cookie);
});
test.afterAll(async () => ctx?.close());

const scaleGroup = (p: Page) => p.getByRole('group', { name: 'Scale', exact: true });
const factor = (p: Page, name: '1/2x' | '1x' | '2x' | 'Custom') =>
  scaleGroup(p).getByRole('button', { name, exact: true });
const summary = (p: Page) => p.getByRole('region', { name: 'Scale and units' }).getByRole('status');
const scaleError = (p: Page) => p.locator('p[role="alert"]');
const qty = (p: Page, text: string) => p.locator('.rg-qty', { hasText: text });

async function open(p: Page) {
  await p.goto(`/recipes/${id}`);
  await hydrated(factor(p, '2x'));
  await expect(p.getByRole('heading', { name: 'Mocha Skillet Cookie', level: 1 })).toBeVisible();
}

test('metric preference: butter shows 115 g (4 oz); 2x doubles both sides', async () => {
  await open(page);
  await expect(qty(page, '115 g (4 oz)')).toHaveCount(1);
  await expect(summary(page)).toHaveText('Showing the original amounts.');
  await expect(factor(page, '1x')).toHaveAttribute('aria-pressed', 'true');

  await factor(page, '2x').click();
  await expect(factor(page, '2x')).toHaveAttribute('aria-pressed', 'true');
  await expect(qty(page, '230 g (8 oz)')).toHaveCount(1);
  await expect(page.getByText('4 large eggs')).toBeVisible();
  await expect(summary(page)).toHaveText('Showing amounts at 2x: serves 16.');

  await factor(page, '1/2x').click();
  // 57.5 g is shown rounded to a 5 g step, so it carries the approximation marker.
  await expect(qty(page, '60 g (2 oz)')).toContainText('≈');
  await expect(qty(page, '60 g (2 oz)')).toContainText('about');
  await expect(page.getByText('1 large eggs')).toBeVisible();
});

test('times and temperatures never scale', async () => {
  await open(page);
  const bake = page.getByText('Heat the oven to 350°F (170°C).');
  const params = page.getByText('350°F (170°C) 30 to 40 min');
  await expect(bake).toBeVisible();
  await expect(params.first()).toBeVisible();
  await factor(page, '2x').click();
  await expect(qty(page, '230 g (8 oz)')).toHaveCount(1);
  await expect(bake).toBeVisible();
  await factor(page, 'Custom').click();
  await page.getByLabel('Servings', { exact: true }).fill('24');
  await expect(summary(page)).toHaveText('Showing amounts at 3x: serves 24.');
  await expect(bake).toBeVisible();
  await expect(params.first()).toBeVisible();
});

test('custom servings target scales by the ratio, validates input, and shows ≈ for odd counts', async () => {
  await open(page);
  await factor(page, 'Custom').click();
  const field = page.getByLabel('Servings', { exact: true });
  await field.fill('12');
  await expect(summary(page)).toHaveText('Showing amounts at 1½x: serves 12.');
  await expect(page.getByText('3 large eggs')).toBeVisible();

  // 2 eggs at 1.25x = 2.5: shown as an approximation, announced to screen readers as "about".
  await field.fill('10');
  const eggs = page.locator('.rg-qty', { hasText: 'about' });
  await expect(eggs.filter({ hasText: '2½' })).toHaveCount(1);
  await expect(eggs.filter({ hasText: '2½' })).toContainText('≈');

  for (const bad of ['0', '-2', 'abc', '1000']) {
    await field.fill(bad);
    await expect(scaleError(page)).toContainText('Enter a number above 0');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  }
  // A decimal comma is accepted.
  await field.fill('12,0');
  await expect(scaleError(page)).toHaveCount(0);
  await expect(summary(page)).toHaveText('Showing amounts at 1½x: serves 12.');
});

test('toggle flips the primary system and Reset restores the preference', async () => {
  await open(page);
  await expect(qty(page, '115 g (4 oz)')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show in US units' }).click();
  await expect(qty(page, '4 oz (115 g)')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Show in metric' })).toBeVisible();

  await factor(page, '2x').click();
  await expect(qty(page, '8 oz (230 g)')).toHaveCount(1);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(qty(page, '115 g (4 oz)')).toHaveCount(1);
  await expect(factor(page, '1x')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Reset' })).toBeDisabled();
});

test('list view scales and toggles too, and the choice is not persisted over a reload', async () => {
  await open(page);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await factor(page, '2x').click();
  await page.getByRole('button', { name: 'Show in US units' }).click();
  await expect(page.getByRole('main').getByText('8 oz (230 g)')).toBeVisible();

  await page.reload();
  await hydrated(factor(page, '2x'));
  await expect(factor(page, '1x')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Show in US units' })).toBeVisible();
  await expect(page.getByRole('main').getByText('115 g (4 oz)')).toBeVisible();
  await expect(summary(page)).toHaveText('Showing the original amounts.');
  // The list/grid preference is the separate, persisted one; put it back for later tests.
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
});

test('changing the profile preference to US takes effect on the recipe page', async () => {
  await page.goto('/profile');
  await hydrated(page.getByLabel('Units'));
  await page.getByLabel('Units').selectOption('us');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();

  await open(page);
  await expect(qty(page, '4 oz (115 g)')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Show in metric' })).toBeVisible();
  await factor(page, '2x').click();
  await expect(qty(page, '8 oz (230 g)')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show in metric' }).click();
  await expect(qty(page, '230 g (8 oz)')).toHaveCount(1);
});

test('keyboard only: reach the scale controls with Tab and operate them with Space', async () => {
  await open(page);
  await factor(page, '2x').focus();
  await page.keyboard.press('Space');
  await expect(qty(page, '8 oz (230 g)')).toHaveCount(1);
  await page.keyboard.press('Tab'); // Custom
  await expect(factor(page, 'Custom')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); // the Servings field
  await expect(page.getByLabel('Servings', { exact: true })).toBeFocused();
  await page.keyboard.type('4');
  await expect(summary(page)).toHaveText('Showing amounts at ½x: serves 4.');
});
