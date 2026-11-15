import { expect, test, type BrowserContext } from '@playwright/test';
import {
  account,
  captureConsole,
  createRecipe,
  hydrated,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';
import { importedCake, makeLink } from './share-support';

// Hydration control (v0.3.1 carryover, run in T12). The production build logs a hydration
// mismatch as a minified React error (#418/#423/#425) or "Hydration failed" text; captureConsole
// recognises both. The positive assertion below must stay green; the negative control (a
// deliberate server/client mismatch makes it fail) was run by hand and recorded in the T12 notes.
test.describe.configure({ mode: 'serial' });

const me = account('hydra');
let ctx: BrowserContext;
let id = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  ctx = await browser.newContext();
  await signIn(await ctx.newPage(), me);
  id = await createRecipe(ctx, { ...SAMPLES.cookie, tags: ['coffee', 'dessert'] });
});
test.afterAll(async () => ctx?.close());

for (const pref of ['metric', 'us'] as const) {
  test(`recipe page with tags and scale controls hydrates cleanly (${pref} preference)`, async () => {
    const p = await ctx.newPage();
    await p.goto('/profile');
    await hydrated(p.getByLabel('Units'));
    await p.getByLabel('Units').selectOption(pref);
    await p.getByRole('button', { name: 'Save' }).click();
    await expect(p.getByText('Profile saved.')).toBeVisible();

    const logs = captureConsole(p); // attach BEFORE the navigation under test
    await p.goto(`/recipes/${id}`);
    await hydrated(p.getByRole('button', { name: '2x', exact: true }));
    // Exercise the client state too: it must not warn either.
    await p.getByRole('button', { name: '2x', exact: true }).click();
    await p.getByRole('button', { name: /Show in/ }).click();
    await p.reload();
    await hydrated(p.getByRole('button', { name: '2x', exact: true }));

    expect(logs.hydrationMessages()).toEqual([]);
    expect(logs.all()).toEqual([]);
    await p.close();
  });
}

test('the recipe list with search and chips hydrates cleanly', async () => {
  const p = await ctx.newPage();
  const logs = captureConsole(p);
  await p.goto('/recipes?q=chocolate&tag=coffee');
  await hydrated(p.getByRole('searchbox', { name: 'Search recipes' }));
  await expect(
    p.getByRole('main').getByRole('heading', { name: 'Mocha Skillet Cookie' }),
  ).toBeVisible();
  expect(logs.hydrationMessages()).toEqual([]);
  expect(logs.all()).toEqual([]);
  await p.close();
});

test('the public page /r/:token hydrates cleanly, also after scale, units and view changes', async ({
  browser,
}) => {
  const shared = await createRecipe(ctx, importedCake('Hydration Public Cake'));
  const url = await makeLink(ctx, shared);
  // A guest: fresh context, no cookies, so the page is the anonymous server render.
  const guest = await browser.newContext();
  const p = await guest.newPage();
  const logs = captureConsole(p); // attach BEFORE the navigation under test
  await p.goto(url);
  await hydrated(p.getByRole('button', { name: '2x', exact: true }));
  await p.getByRole('button', { name: '2x', exact: true }).click();
  await p.getByRole('button', { name: /Show in/ }).click();
  await p.getByRole('button', { name: 'List', exact: true }).click();
  await p.reload();
  await hydrated(p.getByRole('button', { name: '2x', exact: true }));
  expect(logs.hydrationMessages()).toEqual([]);
  expect(logs.all()).toEqual([]);

  // The uniform 404 is server rendered too (the browser itself logs the 404 status, so only
  // hydration messages are checked here).
  logs.clear();
  await p.goto('/r/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(p.getByText('This link is invalid or has expired.')).toBeVisible();
  await p.waitForLoadState('networkidle');
  expect(logs.hydrationMessages()).toEqual([]);
  await guest.close();
});
