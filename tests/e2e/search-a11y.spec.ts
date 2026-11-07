import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  createRecipe,
  expectNoAxeViolations,
  hydrated,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';

// T12: axe (WCAG 2.1 A/AA incl. contrast) on the 04a UI: results + chips, empty state, tag
// field with the listbox open, scale controls, import review tags. Light and dark, 375 and 1280.
test.describe.configure({ mode: 'serial' });

const me = account('axel');
let setupCtx: BrowserContext;
let recipeId = '';

const VIEWS = [
  { w: 375, h: 812, scheme: 'light' },
  { w: 1280, h: 800, scheme: 'light' },
  { w: 375, h: 812, scheme: 'dark' },
  { w: 1280, h: 800, scheme: 'dark' },
] as const;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  setupCtx = await browser.newContext();
  await signIn(await setupCtx.newPage(), me);
  recipeId = await createRecipe(setupCtx, { ...SAMPLES.cookie, tags: ['coffee', 'dessert'] });
  await createRecipe(setupCtx, { ...SAMPLES.cake, tags: ['dessert', 'party'] });
});
test.afterAll(async () => setupCtx?.close());

async function open(
  browser: Browser,
  path: string,
  v: { w: number; h: number; scheme: 'light' | 'dark' },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    colorScheme: v.scheme,
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(path);
  return { page, close: () => ctx.close() };
}

for (const v of VIEWS) {
  const tag = `${v.scheme} ${v.w}`;

  test(`axe: /recipes with search results and active chip (${tag})`, async ({ browser }) => {
    const { page, close } = await open(browser, '/recipes?q=chocolate&tag=coffee', v);
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Mocha Skillet Cookie' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /^coffee,.*Filter active/ })).toBeVisible();
    await expectNoAxeViolations(page);
    await close();
  });

  test(`axe: /recipes empty search state (${tag})`, async ({ browser }) => {
    const { page, close } = await open(browser, '/recipes?q=zzzqx', v);
    await expect(page.getByRole('heading', { name: 'No recipes found' })).toBeVisible();
    await expectNoAxeViolations(page);
    await close();
  });

  test(`axe: recipe page with tag chips and scale controls (${tag})`, async ({ browser }) => {
    const { page, close } = await open(browser, `/recipes/${recipeId}`, v);
    await expect(page.getByRole('list', { name: 'Tags', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    // Custom input, its error state and the converted display.
    await hydrated(page.getByRole('button', { name: '2x', exact: true }));
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await page.getByLabel('Servings', { exact: true }).fill('abc');
    await expect(page.locator('p[role="alert"]')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByLabel('Servings', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Show in US units' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await close();
  });

  test(`axe: tag field with the suggestion list open (${tag})`, async ({ browser }) => {
    const { page, close } = await open(browser, '/recipes/new', v);
    const input = page.getByRole('combobox', { name: 'Tags' });
    await hydrated(input);
    await input.fill('Brunch');
    await input.press('Enter');
    await input.pressSequentially('des');
    await expect(page.getByRole('listbox', { name: 'Tag suggestions' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'dessert' })).toBeVisible();
    await expectNoAxeViolations(page);
    await input.press('Escape');
    // Limit error state.
    await input.fill(Array.from({ length: 20 }, (_, i) => `x${i}`).join(', ') + ',');
    await input.fill('one more');
    await input.press('Enter');
    await expect(
      page.locator('p', { hasText: 'A recipe can have at most 20 tags.' }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await close();
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: import review with tag chips (${scheme}, 1280)`, async ({ browser }) => {
    const { page, close } = await open(browser, '/import', { w: 1280, h: 800, scheme });
    const html = `<html><head><title>A11y Soup</title><script type="application/ld+json">${JSON.stringify(
      {
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: 'A11y Soup',
        keywords: 'soup, winter',
        recipeIngredient: ['2 cups water', '1 tsp salt'],
        recipeInstructions: [{ '@type': 'HowToStep', text: 'Boil the water.' }],
      },
    )}</script></head><body></body></html>`;
    await hydrated(page.getByLabel('Recipe web address'));
    await page.getByRole('tab', { name: 'Paste the recipe' }).click();
    await page.getByLabel('Recipe text or page source').fill(html);
    await page.getByRole('button', { name: 'Import recipe' }).click();
    await expect(page.getByRole('heading', { name: 'Review the imported recipe' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove tag winter' })).toBeVisible();
    await expectNoAxeViolations(page);
    await close();
  });
}
