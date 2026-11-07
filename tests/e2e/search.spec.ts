import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

// T12 search flows: header search (debounce -> URL), results, empty state, visibility, tag chips.
// Both users and all recipes are created here (API setup), so the file owns its data.
test.describe.configure({ mode: 'serial' });

const alice = account('sally');
const bob = account('sam');
let aliceCtx: BrowserContext;
let bobCtx: BrowserContext;
let ap: Page;
let bp: Page;

const COOKIE = 'Mocha Skillet Cookie'; // private to alice, mentions "espresso"
const CAKE = 'Vanilla Cake with Frosting'; // shared with all members
const SALAD = 'Sam Green Salad'; // bob's own

const main = (p: Page) => p.getByRole('main');
const card = (p: Page, title: string) => main(p).getByRole('heading', { name: title, level: 2 });
const search = (p: Page) => p.getByRole('searchbox', { name: 'Search recipes' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, alice);
  await registerViaInvite(browser, bob);
  aliceCtx = await browser.newContext();
  bobCtx = await browser.newContext();
  ap = await aliceCtx.newPage();
  bp = await bobCtx.newPage();
  await signIn(ap, alice);
  await signIn(bp, bob);
  await createRecipe(aliceCtx, {
    ...SAMPLES.cookie,
    visibility: 'private',
    tags: ['coffee', 'dessert'],
  });
  await createRecipe(aliceCtx, {
    ...SAMPLES.cake,
    visibility: 'users',
    tags: ['dessert', 'party'],
  });
  await createRecipe(bobCtx, {
    ...SAMPLES.cake,
    title: SALAD,
    description: 'Leaves.',
    visibility: 'private',
    tags: ['salad'],
  });
});
test.afterAll(async () => {
  await aliceCtx?.close();
  await bobCtx?.close();
});

test('typing in the header search updates ?q= after the pause, without a page reload', async () => {
  await ap.goto('/recipes');
  await hydrated(search(ap));
  await ap.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));

  await search(ap).fill('espresso');
  await expect(ap).toHaveURL(/\/recipes\?q=espresso$/);
  await expect(card(ap, COOKIE)).toBeVisible();
  await expect(card(ap, CAKE)).toHaveCount(0);
  await expect(ap.getByRole('status').filter({ hasText: 'found' })).toHaveText('1 recipe found');
  // Client-side navigation: the window (and its marker) survived.
  expect(await ap.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);

  // Reload restores the state from the URL.
  await ap.reload();
  await expect(search(ap)).toHaveValue('espresso');
  await expect(card(ap, COOKIE)).toBeVisible();
});

test('a prefix finds the recipe', async () => {
  // The 2-character minimum is covered by the search-url unit tests.
  await ap.goto('/recipes');
  await hydrated(search(ap));
  await search(ap).fill('espr');
  await expect(ap).toHaveURL(/\/recipes\?q=espr$/);
  await expect(card(ap, COOKIE)).toBeVisible();
});

test('no results shows the empty state with a way back', async () => {
  await ap.goto('/recipes');
  await hydrated(search(ap));
  await search(ap).fill('zzzqx');
  await expect(ap).toHaveURL(/q=zzzqx/);
  await expect(main(ap).getByRole('heading', { name: 'No recipes found' })).toBeVisible();
  await expect(main(ap).getByText('Nothing matched “zzzqx”')).toBeVisible();
  await expect(ap.getByRole('status').filter({ hasText: 'found' })).toHaveText('0 recipes found');
  await main(ap).getByRole('link', { name: 'Clear all filters' }).click();
  await expect(ap).toHaveURL(/\/recipes$/);
  await expect(card(ap, COOKIE)).toBeVisible();
  await expect(card(ap, CAKE)).toBeVisible();
});

test('another member never finds a private recipe, nor its tags, by search or by URL', async () => {
  await bp.goto('/recipes?q=espresso');
  await expect(main(bp).getByRole('heading', { name: 'No recipes found' })).toBeVisible();
  await expect(card(bp, COOKIE)).toHaveCount(0);

  await bp.goto('/recipes?tag=coffee');
  await expect(main(bp).getByRole('heading', { name: 'No recipes found' })).toBeVisible();

  // Chips only list tags on readable recipes: the shared cake's tags yes, the private cookie's no.
  await bp.goto('/recipes');
  const chips = bp.getByRole('navigation', { name: 'Filter by tag' });
  await expect(chips.getByRole('link', { name: /^dessert,/ })).toBeVisible();
  await expect(chips.getByRole('link', { name: /^salad,/ })).toBeVisible();
  await expect(chips.getByRole('link', { name: /^coffee,/ })).toHaveCount(0);

  // The shared cake is searchable by bob; the cookie only by its owner.
  await search(bp).fill('frosting');
  await expect(card(bp, CAKE)).toBeVisible();
});

test('tag chips filter the list, combine with a query, and toggle off', async () => {
  await ap.goto('/recipes');
  const chips = ap.getByRole('navigation', { name: 'Filter by tag' });
  await chips.getByRole('link', { name: /^coffee,/ }).click();
  await expect(ap).toHaveURL(/\/recipes\?tag=coffee$/);
  await expect(card(ap, COOKIE)).toBeVisible();
  await expect(card(ap, CAKE)).toHaveCount(0);
  await expect(chips.getByRole('link', { name: /^coffee,.*Filter active/ })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Combine with a query on the same tag; the tag stays in the URL.
  await hydrated(search(ap));
  await search(ap).fill('chocolate');
  await expect(ap).toHaveURL(/\/recipes\?q=chocolate&tag=coffee$/);
  await expect(card(ap, COOKIE)).toBeVisible();

  // A query that the tagged recipe does not match gives the empty state, not the other recipe.
  await search(ap).fill('frosting');
  await expect(ap).toHaveURL(/q=frosting&tag=coffee/);
  await expect(main(ap).getByRole('heading', { name: 'No recipes found' })).toBeVisible();

  // Clicking the active chip removes the tag but keeps the query.
  await chips.getByRole('link', { name: /^coffee,.*Filter active/ }).click();
  await expect(ap).toHaveURL(/\/recipes\?q=frosting$/);
  await expect(card(ap, CAKE)).toBeVisible();
  await expect(card(ap, COOKIE)).toHaveCount(0);
});

test('Escape clears the search and the URL', async () => {
  await ap.goto('/recipes');
  await hydrated(search(ap));
  await search(ap).fill('espresso');
  await expect(ap).toHaveURL(/q=espresso/);
  await search(ap).press('Escape');
  await expect(search(ap)).toHaveValue('');
  await expect(ap).toHaveURL(/\/recipes$/);
  await expect(card(ap, CAKE)).toBeVisible();
  await expect(card(ap, COOKIE)).toBeVisible();
});

test('back and forward follow the search state', async () => {
  await ap.goto('/recipes');
  await hydrated(search(ap));
  await ap
    .getByRole('navigation', { name: 'Filter by tag' })
    .getByRole('link', { name: /^party,/ })
    .click();
  await expect(ap).toHaveURL(/tag=party/);
  await ap.goBack();
  await expect(ap).toHaveURL(/\/recipes$/);
  await expect(card(ap, COOKIE)).toBeVisible();
  await ap.goForward();
  await expect(ap).toHaveURL(/tag=party/);
  await expect(card(ap, COOKIE)).toHaveCount(0);
});

test('keyboard only: reach the search box, type, submit with Enter', async () => {
  await ap.goto('/recipes');
  await hydrated(search(ap));
  await search(ap).focus();
  await ap.keyboard.type('vanilla');
  await ap.keyboard.press('Enter');
  await expect(ap).toHaveURL(/q=vanilla/);
  await expect(card(ap, CAKE)).toBeVisible();
});
