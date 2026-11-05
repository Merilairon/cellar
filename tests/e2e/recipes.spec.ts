import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, ORIGIN, registerViaInvite, SAMPLES, signIn } from './helpers';

// T16 main flow. Users are created through the admin invite flow so this file owns its data;
// it needs the admin from auth.spec.ts, which always runs first on the fresh e2e DB.
test.describe.configure({ mode: 'serial' });

const owner = account('olivia');
const reader = account('rita');
let ownerCtx: BrowserContext;
let readerCtx: BrowserContext;
let op: Page;
let rp: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, owner);
  await registerViaInvite(browser, reader);
  ownerCtx = await browser.newContext();
  readerCtx = await browser.newContext();
  op = await ownerCtx.newPage();
  rp = await readerCtx.newPage();
  await signIn(op, owner);
  await signIn(rp, reader);
});
test.afterAll(async () => {
  await ownerCtx?.close();
  await readerCtx?.close();
});

const recipeId = (p: Page) => new URL(p.url()).pathname.split('/').pop()!;

async function addStep(
  page: Page,
  n: number,
  s: { kind: string; label: string; detail: string; from?: string; to?: string },
) {
  await page.getByRole('button', { name: 'Add step' }).click();
  const g = page.getByRole('group', { name: `Step ${n}`, exact: true });
  await g.getByLabel('Kind').selectOption({ label: s.kind });
  await g.getByLabel('Label', { exact: true }).fill(s.label);
  await g.getByLabel('Detail').fill(s.detail);
  if (s.from) await g.getByLabel('First ingredient row').fill(s.from);
  if (s.to) await g.getByLabel('Last ingredient row').fill(s.to);
}

async function fillBasics(page: Page, title: string) {
  await page.goto('/recipes/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Servings', { exact: true }).fill('4');
  await page.getByLabel('Ingredients').fill('2 cups flour\n1 cup sugar\n3 eggs');
  // Live preview parses the lines before anything is saved.
  await expect(page.getByText('How each line is read')).toBeVisible();
}

test('empty state offers both calls to action', async () => {
  await op.goto('/recipes');
  await expect(op.getByRole('heading', { name: 'Your recipe book is empty' })).toBeVisible();
  await expect(op.getByRole('link', { name: 'New recipe' })).toHaveAttribute(
    'href',
    '/recipes/new',
  );
  await expect(op.getByRole('link', { name: 'Import' }).last()).toHaveAttribute('href', '/import');
});

test('create via form -> grid view, toggle list/grid, preference survives reload', async () => {
  await fillBasics(op, 'Flow Cake');
  await addStep(op, 1, { kind: 'Banner at the top', label: 'prep', detail: 'Heat the oven.' });
  await addStep(op, 2, {
    kind: 'Column step',
    label: 'mix',
    detail: 'Mix flour and sugar.',
    from: '1',
    to: '2',
  });
  await addStep(op, 3, {
    kind: 'Column step',
    label: 'bake',
    detail: 'Bake it all.',
    from: '1',
    to: '3',
  });
  await op.getByRole('button', { name: 'Save recipe' }).click();
  await expect(op).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(op.getByRole('heading', { level: 1, name: 'Flow Cake' })).toBeVisible();

  // Valid spans on every column step -> stored as grid and shown as grid.
  await expect(op.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const table = op.locator('table.rg-table');
  await expect(table.locator('tbody th[scope="row"]')).toHaveCount(3);
  await expect(table.locator('td.rg-banner')).toHaveCount(1);
  expect(
    await table
      .locator('td.rg-step')
      .evaluateAll((tds) => tds.map((t) => (t as HTMLTableCellElement).rowSpan)),
  ).toEqual([2, 3]);

  await op.getByRole('button', { name: 'List' }).click();
  await expect(op.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(table).toHaveCount(0);
  await expect(op.getByText('Mix flour and sugar.')).toBeVisible();

  await op.reload();
  await expect(op.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await op.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(op.locator('table.rg-table')).toHaveCount(1);
  await op.reload();
  await expect(op.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await op.goto('/recipes');
  await expect(op.getByRole('link', { name: /Flow Cake/ })).toBeVisible();
});

test('list recipe: Convert to grid shows inline errors, saves nothing, then succeeds', async () => {
  await fillBasics(op, 'Convert Me');
  await addStep(op, 1, { kind: 'Column step', label: 'mix', detail: 'Mix.' });
  await addStep(op, 2, { kind: 'Column step', label: 'bake', detail: 'Bake.' });
  await op.getByRole('button', { name: 'Save recipe' }).click();
  await expect(op).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  const id = recipeId(op);

  // Missing spans -> list, grid toggle disabled, Convert to grid offered.
  await expect(op.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(op.getByRole('button', { name: 'Grid', exact: true })).toBeDisabled();
  await op.getByRole('button', { name: 'Convert to grid' }).click();

  const mix = op.getByRole('group', { name: /^Step 1: mix/ });
  const bake = op.getByRole('group', { name: /^Step 2: bake/ });
  await mix.getByLabel('First row').fill('1');
  await mix.getByLabel('Last row').fill('9'); // only 3 ingredient rows exist
  await bake.getByLabel('First row').fill('1');
  await bake.getByLabel('Last row').fill('3');
  await op.getByRole('button', { name: 'Save as grid' }).click();
  await expect(mix.getByText(/This row does not exist/)).toBeVisible();
  await expect(op.getByText('Fix the highlighted row numbers and try again.')).toBeVisible();
  const r0 = await ownerCtx.request.get(`/api/recipes/${id}`);
  const stored = await r0.json();
  expect(stored.view_mode).toBe('list'); // nothing saved

  await mix.getByLabel('Last row').fill('2');
  await op.getByRole('button', { name: 'Save as grid' }).click();
  await expect(op.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(op.locator('table.rg-table')).toHaveCount(1);
  await expect(op.getByRole('button', { name: 'Convert to grid' })).toHaveCount(0);
  expect((await (await ownerCtx.request.get(`/api/recipes/${id}`)).json()).view_mode).toBe('grid');
});

test('API: invalid spans are rejected with 422 and a field path; valid ones are not', async () => {
  const bad = (spans: { row_start: number; row_end: number }) => ({
    ...SAMPLES.cookie,
    title: 'Bad spans',
    view_mode: 'grid',
    sections: [
      {
        ...SAMPLES.cookie.sections[0],
        steps: [{ kind: 'column', label: 'x', detail: 'x', ...spans }],
      },
    ],
  });
  const post = (data: object) => ownerCtx.request.post('/api/recipes', { headers: ORIGIN, data });

  const outOfRange = await post(bad({ row_start: 0, row_end: 50 }));
  expect(outOfRange.status()).toBe(422);
  const body = (await outOfRange.json()) as { errors: { path: string; code: string }[] };
  expect(body.errors.map((e) => e.path)).toContain('sections.0.steps.0.row_end');

  const reversed = await post(bad({ row_start: 5, row_end: 2 }));
  expect(reversed.status()).toBe(422);

  const missingOrigin = await ownerCtx.request.post('/api/recipes', {
    data: bad({ row_start: 0, row_end: 1 }),
  });
  expect(missingOrigin.status()).toBe(403); // CSRF guard runs before validation

  expect((await post(bad({ row_start: 0, row_end: 1 }))).status()).toBe(201);
});

test('9 column steps default to list on a phone, grid is one tap away', async ({ browser }) => {
  const steps = Array.from({ length: 9 }, (_, i) => ({
    kind: 'column',
    label: `s${i + 1}`,
    detail: `Do ${i + 1}`,
    row_start: 0,
    row_end: 8,
  }));
  const id = await createRecipe(ownerCtx, {
    ...SAMPLES.cookie,
    title: 'Nine columns',
    sections: [{ ...SAMPLES.cookie.sections[0], steps }],
  });
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    // Cookies only: an earlier test stored an explicit grid preference in localStorage.
    storageState: { cookies: (await ownerCtx.storageState()).cookies, origins: [] },
  });
  const p = await ctx.newPage();
  await p.goto(`/recipes/${id}`);
  await expect(p.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator('table.rg-table')).toHaveCount(0);
  await p.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(p.locator('table.rg-table th[scope="col"]')).toHaveCount(10);
  await ctx.close();
});

test('share, second user sees it read-only, saves an independent private copy', async () => {
  const id = await createRecipe(ownerCtx, { ...SAMPLES.cake, title: 'Shared Cake' });
  const priv = await createRecipe(ownerCtx, { ...SAMPLES.cookie, title: 'Private Cookie' });

  // Private: invisible to the other user (same 404 as a missing id).
  expect((await readerCtx.request.get(`/api/recipes/${id}`)).status()).toBe(404);

  await op.goto(`/recipes/${id}`);
  await op.getByLabel('Share with all users (read-only)').check();
  await expect(op.getByRole('status').filter({ hasText: 'Shared with all users.' })).toBeVisible();

  await rp.goto('/recipes');
  await expect(rp.getByRole('link', { name: /Shared Cake/ })).toContainText(
    `Shared by ${owner.name}`,
  );
  await expect(rp.getByRole('link', { name: /Private Cookie/ })).toHaveCount(0);
  expect((await readerCtx.request.get(`/api/recipes/${priv}`)).status()).toBe(404);

  await rp.getByRole('link', { name: /Shared Cake/ }).click();
  await expect(rp.getByText(/This recipe is read-only/)).toBeVisible();
  await expect(rp.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await expect(rp.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  // The reader cannot write to it through the API either.
  const put = await readerCtx.request.put(`/api/recipes/${id}`, {
    headers: ORIGIN,
    data: { ...SAMPLES.cake, title: 'Hijacked' },
  });
  expect([403, 404]).toContain(put.status());
  expect(
    (await readerCtx.request.delete(`/api/recipes/${id}`, { headers: ORIGIN })).status(),
  ).not.toBe(204);

  await rp.getByRole('button', { name: 'Save a copy' }).click();
  await expect(rp).not.toHaveURL(new RegExp(`${id}$`)); // navigated to the copy
  await expect(rp).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  const copyId = recipeId(rp);
  expect(copyId).not.toBe(id);
  await expect(rp.getByRole('link', { name: 'Edit' })).toBeVisible(); // reader owns the copy
  await expect(rp.getByText(/This recipe is read-only/)).toHaveCount(0);
  const copy = await (await readerCtx.request.get(`/api/recipes/${copyId}`)).json();
  expect(copy.visibility).toBe('private');

  // Independence: deleting the copy leaves the original untouched.
  await rp.getByRole('button', { name: 'Delete' }).click();
  await rp.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(rp).toHaveURL(/\/recipes$/);
  expect((await ownerCtx.request.get(`/api/recipes/${id}`)).status()).toBe(200);
  expect((await readerCtx.request.get(`/api/recipes/${id}`)).status()).toBe(200);
});

test('owner deletes with a two-step confirm; recipe is gone', async () => {
  await op.goto('/recipes');
  await op.getByRole('link', { name: /Flow Cake/ }).click();
  const id = recipeId(op);
  await op.getByRole('button', { name: 'Delete' }).click();
  await op.getByRole('button', { name: 'Cancel' }).click(); // cancel keeps it
  await expect(op.getByRole('heading', { level: 1, name: 'Flow Cake' })).toBeVisible();
  await op.getByRole('button', { name: 'Delete' }).click();
  await op.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(op).toHaveURL(/\/recipes$/);
  await expect(op.getByRole('link', { name: /Flow Cake/ })).toHaveCount(0);
  expect((await ownerCtx.request.get(`/api/recipes/${id}`)).status()).toBe(404);
});
