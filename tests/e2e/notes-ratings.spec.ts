import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
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
import { apiPhotos, apiUpload, expectLoaded, makeImage } from './media-support';

// T11 part 2: notes visibility, ratings and min_rating, grid editor coexistence, hydration.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const alice = account('nra');
const bob = account('nrb');
let aCtx: BrowserContext;
let bCtx: BrowserContext;
let id = '';
const TITLE = 'Notes Rating Cake';
const PRIVATE_WORD = 'zephyrquince';
const SHARED_WORD = 'marzipanwidget';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, alice);
  await registerViaInvite(browser, bob);
  aCtx = await browser.newContext();
  bCtx = await browser.newContext();
  await signIn(await aCtx.newPage(), alice);
  await signIn(await bCtx.newPage(), bob);
  id = await createRecipe(aCtx, { ...SAMPLES.cake, title: TITLE, visibility: 'users' });
});
test.afterAll(async () => {
  // Shared recipes would show up in every other member's list and break specs that expect an
  // empty book (recipes.spec.ts), so remove what this file created.
  for (const rid of [id]) {
    if (rid) await aCtx?.request.delete(`/api/recipes/${rid}`, { headers: ORIGIN });
  }
  await aCtx?.close();
  await bCtx?.close();
});

const main = (p: Page) => p.getByRole('main');
const card = (p: Page) => main(p).getByRole('heading', { name: TITLE, level: 2 });

async function addNote(
  page: Page,
  text: string,
  visibility: 'Only me' | 'Everyone who can see this recipe',
) {
  const area = page.getByLabel('Add a note');
  await hydrated(area);
  await area.fill(text);
  await page.getByLabel(visibility).check();
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Note added.')).toBeVisible();
}

test('private and shared notes: the other user only sees the shared one', async () => {
  const a = await aCtx.newPage();
  await a.goto(`/recipes/${id}`);
  await addNote(a, `my secret ${PRIVATE_WORD} thought`, 'Only me');
  await addNote(a, `family ${SHARED_WORD} tip`, 'Everyone who can see this recipe');
  await expect(a.getByRole('heading', { name: 'Notes (2)' })).toBeVisible();
  await expect(a.getByText('Only you')).toBeVisible();
  // Reload: server rendered, same.
  await a.reload();
  await expect(a.getByText(`my secret ${PRIVATE_WORD} thought`)).toBeVisible();

  const b = await bCtx.newPage();
  await b.goto(`/recipes/${id}`);
  await expect(b.getByRole('heading', { name: 'Notes (1)' })).toBeVisible();
  await expect(b.getByText(`family ${SHARED_WORD} tip`)).toBeVisible();
  await expect(b.getByText(PRIVATE_WORD)).toHaveCount(0);
  await expect(b.getByText('nra', { exact: true })).toBeVisible(); // author name on the shared note
  // Not editable by B: no Edit/Delete on A's shared note.
  await expect(b.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(b.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await a.close();
  await b.close();
});

test('search: own private word found, other user private word not found, shared word found', async () => {
  const a = await aCtx.newPage();
  const b = await bCtx.newPage();
  await a.goto(`/recipes?q=${PRIVATE_WORD}`);
  await expect(card(a)).toBeVisible();
  await b.goto(`/recipes?q=${PRIVATE_WORD}`);
  await expect(b.getByRole('heading', { name: 'No recipes found' })).toBeVisible();
  await expect(card(b)).toHaveCount(0);
  await b.goto(`/recipes?q=${SHARED_WORD}`);
  await expect(card(b)).toBeVisible();

  // Edit own note into a shared one through the UI; the word becomes findable by B.
  await a.goto(`/recipes/${id}`);
  const item = a.getByRole('listitem').filter({ hasText: PRIVATE_WORD });
  await hydrated(item.getByRole('button', { name: 'Edit' }));
  await item.getByRole('button', { name: 'Edit' }).click();
  await item.getByLabel('Everyone who can see this recipe').check();
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(a.getByText('Note saved.')).toBeVisible();
  await b.goto(`/recipes?q=${PRIVATE_WORD}`);
  await expect(card(b)).toBeVisible();
  await a.close();
  await b.close();
});

async function rate(page: Page, n: number) {
  const put = page.waitForResponse(
    (r) => r.url().includes('/rating') && r.request().method() === 'PUT',
  );
  await page
    .locator('label.md-star', { has: page.getByRole('radio', { name: `${n} of 5 stars` }) })
    .click();
  expect((await put).status()).toBe(200);
  await expect(page.getByText(`Your rating is ${n} of 5 stars.`)).toBeVisible();
}

test('ratings: set, change, clear; average on page and card', async () => {
  const a = await aCtx.newPage();
  const b = await bCtx.newPage();
  await a.goto(`/recipes/${id}`);
  await hydrated(a.getByRole('radio', { name: '4 of 5 stars' }));
  await expect(a.getByText('No ratings yet')).toBeVisible();
  await rate(a, 5);
  await expect(a.getByText('5.0 from 1 rating')).toBeVisible();
  await rate(a, 4); // change
  await expect(a.getByText('4.0 from 1 rating')).toBeVisible();

  await b.goto(`/recipes/${id}`);
  await hydrated(b.getByRole('radio', { name: '2 of 5 stars' }));
  await expect(b.getByText('4.0 from 1 rating')).toBeVisible();
  await rate(b, 2);
  await expect(b.getByText('3.0 from 2 ratings')).toBeVisible();

  await a.goto('/recipes');
  await expect(main(a).getByText('Average rating 3.0 of 5 from 2 ratings')).toBeVisible();

  // B clears: the average falls back to A's rating, and B's control is empty again.
  await b.getByRole('button', { name: 'Clear my rating' }).click();
  await expect(b.getByText('Your rating was cleared.')).toBeVisible();
  await expect(b.getByText('4.0 from 1 rating')).toBeVisible();
  await b.reload();
  await expect(b.getByText('Not rated yet')).toBeVisible();
  await expect(b.getByText('4.0 from 1 rating')).toBeVisible();
  await a.close();
  await b.close();
});

test('min_rating filter: chips, URL, inclusive boundary, empty copy, combines with q', async () => {
  const b = await bCtx.newPage();
  await b.goto(`/recipes/${id}`);
  await hydrated(b.getByRole('radio', { name: '2 of 5 stars' }));
  await rate(b, 2); // average is 3.0 again (A 4, B 2)
  await b.goto('/recipes');
  await hydrated(b.getByRole('searchbox', { name: 'Search recipes' }));
  await b.getByRole('link', { name: '3 stars or more' }).click();
  await expect(b).toHaveURL(/\/recipes\?min_rating=3$/);
  await expect(card(b)).toBeVisible(); // 3.0 matches min 3 (inclusive)
  await expect(b.getByRole('link', { name: 'Remove minimum rating filter' })).toBeVisible();
  await expect(b.getByRole('link', { name: '3 stars or more' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  await b.getByRole('link', { name: '4 stars or more' }).click();
  await expect(b).toHaveURL(/min_rating=4/);
  await expect(b.getByRole('heading', { name: 'No recipes found' })).toBeVisible();
  await expect(b.getByText(/No recipes with an average of 4 stars or more match/)).toBeVisible();

  // Shareable URL, combined with q (the shared word is in a note of this recipe).
  await b.goto(`/recipes?q=${SHARED_WORD}&min_rating=3`);
  await expect(card(b)).toBeVisible();
  await b.goto(`/recipes?q=${SHARED_WORD}&min_rating=4`);
  await expect(card(b)).toHaveCount(0);
  // Changing the chip keeps q; typing keeps min_rating.
  await b.getByRole('link', { name: '3 stars or more' }).click();
  await expect(b).toHaveURL(/q=marzipanwidget/);
  await expect(b).toHaveURL(/min_rating=3/);
  await b.getByRole('link', { name: 'Remove minimum rating filter' }).click();
  await expect(b).toHaveURL(/\/recipes\?q=marzipanwidget$/);
  // Invalid value in a hand-typed URL must not crash the page.
  const res = await b.goto('/recipes?min_rating=9');
  expect(res?.status()).toBeLessThan(500);
  await b.close();
});

async function openEditor(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    storageState: await aCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(`/recipes/${id}`);
  const entry = page.getByRole('button', { name: 'Edit grid' });
  await hydrated(entry);
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  return { page, ctx };
}

test('grid editor save leaves photos, notes and ratings attached and gives no 409 (G5/G6)', async ({
  browser,
}) => {
  const { page, ctx } = await openEditor(browser); // base version captured here
  // Meanwhile, in another session: a photo, a note and a rating are written.
  const up = await apiUpload(
    aCtx,
    id,
    await makeImage('jpeg', { r: 10, g: 150, b: 60 }),
    'image/jpeg',
  );
  expect(up.status()).toBe(201);
  const noteRes = await aCtx.request.post(`/api/recipes/${id}/notes`, {
    headers: ORIGIN,
    data: { body: 'written during grid edit', shared: true },
  });
  expect(noteRes.status()).toBe(201);
  const rateRes = await bCtx.request.put(`/api/recipes/${id}/rating`, {
    headers: ORIGIN,
    data: { stars: 5 },
  });
  expect(rateRes.ok()).toBe(true);

  const row = page.locator('[data-ge-target^="row:"]').first();
  await row.focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Edit ingredient 1' }).fill('7 oz coexist butter');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^Save changes/ }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'This recipe changed while you were editing.' }),
  ).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Everything is still attached, and the ids did not change.
  const photos = await apiPhotos(aCtx, id);
  expect(photos.length).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('coexist butter').first()).toBeVisible();
  await page.reload();
  await expectLoaded(page.getByRole('img', { name: `Photo of ${TITLE}` }));
  await expect(page.getByText('written during grid edit')).toBeVisible();
  await expect(page.getByText(PRIVATE_WORD).first()).toBeVisible();
  await expect(page.getByText('from 2 ratings')).toBeVisible();
  expect(await apiPhotos(aCtx, id)).toEqual(photos);
  await ctx.close();
});

test('recipe page and list with photos, notes, rating and open manager hydrate cleanly', async () => {
  for (const who of [aCtx, bCtx]) {
    const p = await who.newPage();
    const logs = captureConsole(p);
    await p.goto(`/recipes/${id}`);
    await hydrated(p.getByLabel('Add a note'));
    if (who === aCtx) {
      const toggle = p.getByRole('button', { name: 'Edit photos' });
      await hydrated(toggle);
      await toggle.click();
      await expect(p.getByRole('heading', { name: /^Photos \(/ })).toBeVisible();
    }
    await p.reload();
    await hydrated(p.getByLabel('Add a note'));
    await p.goto('/recipes?min_rating=3');
    await hydrated(p.getByRole('searchbox', { name: 'Search recipes' }));
    await expect(card(p)).toBeVisible();
    expect(logs.hydrationMessages()).toEqual([]);
    expect(logs.all()).toEqual([]);
    await p.close();
  }
});
