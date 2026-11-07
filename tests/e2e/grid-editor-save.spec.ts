import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

// T9: save, 422, 409 and network outcomes of the grid editor, and the leave guard.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gesave');
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

async function openEditor(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(`/recipes/${cakeId}`);
  const entry = page.getByRole('button', { name: 'Edit grid' });
  await hydrated(entry);
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  return { page, ctx };
}

const firstRow = (page: Page) => page.locator('[data-ge-target^="row:"]').first();
const save = (page: Page) => page.getByRole('button', { name: /^Save changes|^Saving/ });

async function rename(page: Page, text: string) {
  await firstRow(page).focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Edit ingredient 1' }).fill(text);
  await page.keyboard.press('Enter');
  await expect(firstRow(page)).toContainText(text.split(' ').pop()!);
}

test('save: stays in the editor, keeps undo, Done shows the new grid, next session saves clean', async ({
  browser,
}) => {
  const { page, ctx } = await openEditor(browser);
  let puts = 0;
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith('/grid')) puts++;
  });
  await rename(page, '6 oz unsalted butter');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await save(page).dblclick();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Saved.');
  expect(puts).toBe(1);
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  // Undo history survives the save (Q9): undoing makes the editor dirty again.
  await firstRow(page).focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Edit grid' })).toBeFocused();
  await expect(page.getByText('unsalted butter').first()).toBeVisible();

  // A second session starts from the new base: no false conflict.
  await page.getByRole('button', { name: 'Edit grid' }).click();
  await rename(page, '5 oz unsalted butter');
  await save(page).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await ctx.close();
});

test('422 is mapped to the problems list and keeps local edits', async ({ browser }) => {
  const { page, ctx } = await openEditor(browser);
  await page.route('**/api/recipes/*/grid', (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        errors: [
          { path: 'sections.0.ingredients.0.name', code: 'name_empty' },
          { path: 'nonsense.path', code: 'weird_code' },
        ],
      }),
    }),
  );
  await rename(page, '7 oz rejected butter');
  await save(page).click();
  await expect(page.getByRole('heading', { name: 'Problems and warnings' })).toBeFocused();
  await expect(page.getByText('An ingredient needs a name.')).toBeVisible();
  await expect(page.getByText(/cannot describe \(weird_code\)/)).toBeVisible();
  await expect(firstRow(page)).toContainText('rejected butter');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await ctx.close();
});

test('network failure keeps edits and Try again saves', async ({ browser }) => {
  const { page, ctx } = await openEditor(browser);
  await page.route('**/api/recipes/*/grid', (route) => route.abort());
  await rename(page, '4 oz offline butter');
  await save(page).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Could not save' });
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  await expect(firstRow(page)).toContainText('offline butter');
  await page.unroute('**/api/recipes/*/grid');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(alert).toHaveCount(0);
  await ctx.close();
});

test('409: keep editing, load latest (confirm) and save mine anyway (confirm)', async ({
  browser,
}) => {
  const a = await openEditor(browser);
  const b = await openEditor(browser);
  await rename(a.page, '3 oz first writer');
  await save(a.page).click();
  await expect(a.page.getByText('All changes saved')).toBeVisible();

  await rename(b.page, '2 oz second writer');
  await save(b.page).click();
  const heading = b.page.getByRole('heading', {
    name: 'This recipe changed while you were editing.',
  });
  await expect(heading).toBeFocused();
  // Keep editing: panel closes, edits stay.
  await expect(b.page.getByText('maybe in another tab or by someone else')).toBeVisible();
  await expect(b.page.getByText(/The other version was saved at/)).toBeVisible();
  // F17: the toolbar problem count (if any) still has a Problems panel to focus.
  await expect(b.page.getByRole('heading', { name: 'Problems and warnings' })).toBeVisible();
  await b.page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(heading).toHaveCount(0);
  // F3: the next Save will ask again, and the page says so.
  await expect(b.page.getByTestId('ge-conflict-kept')).toContainText('Saving will ask again');
  await expect(firstRow(b.page)).toContainText('second writer');

  // Load latest asks first, Cancel changes nothing.
  await save(b.page).click();
  await b.page.getByRole('button', { name: 'Load the latest version' }).click();
  await expect(b.page.getByText('This throws away your changes in the editor.')).toBeVisible();
  await b.page
    .getByRole('group', { name: /throws away/ })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await b.page.getByRole('button', { name: 'Load the latest version' }).click();
  await b.page.getByRole('button', { name: 'Discard and load' }).click();
  await expect(firstRow(b.page)).toContainText('first writer');
  await expect(b.page.getByRole('status')).toContainText('Loaded the latest version.');
  await expect(
    b.page.getByText('All changes saved').or(b.page.getByText('Unsaved changes')),
  ).toHaveCount(0);

  // Conflict again, then Save mine anyway.
  await rename(a.page, '1 oz third writer');
  await save(a.page).click();
  await expect(a.page.getByText('All changes saved')).toBeVisible();
  await rename(b.page, '9 oz mine anyway');
  await save(b.page).click();
  await b.page.getByRole('button', { name: 'Replace their version with mine' }).click();
  await expect(b.page.getByText('The other version will be replaced by yours.')).toBeVisible();
  await b.page.getByRole('button', { name: 'Save mine', exact: true }).click();
  await expect(b.page.getByText('All changes saved')).toBeVisible();
  await expect(firstRow(b.page)).toContainText('mine anyway');
  await a.ctx.close();
  await b.ctx.close();
});

test('leave guard: beforeunload only while dirty; Cancel asks once', async ({ browser }) => {
  const { page, ctx } = await openEditor(browser);
  const prompts: string[] = [];
  page.on('dialog', (d) => {
    prompts.push(d.type());
    void d.dismiss();
  });
  await rename(page, '8 oz guarded butter');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Discard your unsaved changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  const prevented = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await save(page).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const cleanPrevented = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(cleanPrevented).toBe(false);
  await ctx.close();
});

test('leave guard: browser Back asks while dirty, Keep and Discard behave, no history pollution', async ({
  browser,
}) => {
  const { page, ctx } = await openEditor(browser);
  const url = page.url();
  const confirm = page.getByText('Discard your unsaved changes?');

  // Clean editor: nothing is held back, Back leaves like on any page.
  // (Dirty first, so an entry exists; then save so it is removed again.)
  await rename(page, '3 oz history butter');
  await save(page).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  // F8: after a save, Done is the primary action.
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveClass(/bg-emerald/);

  // Dirty again: Back is intercepted, the URL stays, the confirm shows, edits are kept.
  await rename(page, '4 oz history butter');
  await page.goBack().catch(() => null);
  await expect(confirm).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(firstRow(page)).toContainText('history butter');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(confirm).toHaveCount(0);

  // A second Back asks again (the entry was pushed back), Discard closes the editor only.
  await page.goBack().catch(() => null);
  await expect(confirm).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit grid' })).toBeVisible();
  expect(page.url()).toBe(url);

  // No extra entry is left behind: one Back now leaves the recipe page.
  await page.goBack().catch(() => null);
  await expect.poll(() => page.url()).not.toBe(url);

  // Saved then Done: Back leaves at once, without a prompt and without an extra step.
  await page.goForward().catch(() => null);
  await expect.poll(() => page.url()).toBe(url);
  await hydrated(page.getByRole('button', { name: 'Edit grid' }));
  await page.getByRole('button', { name: 'Edit grid' }).click();
  await rename(page, '5 oz done butter');
  await save(page).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit grid' })).toBeVisible();
  await page.goBack().catch(() => null);
  await expect.poll(() => page.url()).not.toBe(url);
  await ctx.close();
});

test('m1/m2: while a save is in flight Cancel and Discard are inert; two quick Backs both ask', async ({
  browser,
}) => {
  const { page, ctx } = await openEditor(browser);
  const url = page.url();
  const confirm = page.getByText('Discard your unsaved changes?');
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/recipes/*/grid', async (route) => {
    await gate;
    await route.continue();
  });
  await rename(page, '2 oz inflight butter');
  await save(page).click();
  await expect(page.getByRole('button', { name: /^Saving/ })).toBeVisible();
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toHaveAttribute('aria-disabled', 'true');
  await cancel.click();
  await expect(confirm).toHaveCount(0);
  // Back during the save asks, but Discard cannot drop the edits that are being saved.
  await page.goBack().catch(() => null);
  await expect(confirm).toBeVisible();
  const discard = page.getByRole('button', { name: 'Discard changes' });
  await expect(discard).toHaveAttribute('aria-disabled', 'true');
  await discard.click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeVisible();
  expect(page.url()).toBe(url);
  release();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.unroute('**/api/recipes/*/grid');

  // Two quick Backs while dirty: both are intercepted, the URL stays, the editor stays.
  await rename(page, '1 oz double back butter');
  await page.goBack().catch(() => null);
  await page.goBack().catch(() => null);
  await expect(confirm).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeVisible();
  await ctx.close();
});

test('m12: a 200 with an unreadable body is "saved, reload", not a retry that would hit 409', async ({
  browser,
}) => {
  const { page, ctx } = await openEditor(browser);
  let puts = 0;
  await page.route('**/api/recipes/*/grid', async (route) => {
    puts++;
    await route.fetch(); // the write really happens
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'garbled' });
  });
  await page.route(/\/api\/recipes\/[^/]+$/, (route) =>
    route.request().method() === 'GET' ? route.abort() : route.continue(),
  );
  await rename(page, '9 oz unreadable butter');
  await save(page).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Your changes were saved' });
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload' })).toBeFocused();
  await expect(page.getByText('All changes saved')).toBeVisible();
  expect(puts).toBe(1);
  await ctx.close();
});
