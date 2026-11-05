import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  ADMIN,
  createRecipe,
  ORIGIN,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';

// Admin deletes a member who owns recipes, through /admin/users, on both branches.
// Needs the admin from auth.spec.ts, which always runs first on the fresh e2e DB.
test.describe.configure({ mode: 'serial' });

const reassigned = account('dora'); // deleted, recipes reassigned
const removed = account('dean'); // deleted, recipes deleted
const heir = account('hugo'); // receives dora's recipes and copies one of dean's

let adminCtx: BrowserContext;
let heirCtx: BrowserContext;
let ap: Page;
const ids: { dora: string[]; dean: string[]; deanCopy: string } = {
  dora: [],
  dean: [],
  deanCopy: '',
};

async function signedInContext(browser: Parameters<typeof registerViaInvite>[0], who = ADMIN) {
  const ctx = await browser.newContext();
  await signIn(await ctx.newPage(), who);
  return ctx;
}

const apiStatus = async (ctx: BrowserContext, id: string) =>
  (await ctx.request.get(`/api/recipes/${id}`)).status();

async function deleteViaUi(page: Page, who: ReturnType<typeof account>, reassignTo?: string) {
  await page.goto('/admin/users');
  const row = page.getByRole('row').filter({ hasText: who.email });
  await row.getByText('Delete user', { exact: true }).click();
  if (reassignTo) {
    await row.getByLabel('Reassign their recipes to:').check();
    await row.getByLabel('Reassign recipes to').selectOption({ label: reassignTo });
  } else {
    await row.getByLabel('Delete their recipes').check();
  }
  await row.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('row').filter({ hasText: who.email })).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  for (const who of [reassigned, removed, heir]) await registerViaInvite(browser, who);
  adminCtx = await signedInContext(browser);
  ap = await adminCtx.newPage();
  heirCtx = await signedInContext(browser, heir);

  const doraCtx = await signedInContext(browser, reassigned);
  ids.dora = [
    await createRecipe(doraCtx, SAMPLES.cookie),
    await createRecipe(doraCtx, { ...SAMPLES.cake, visibility: 'users' }),
  ];
  await doraCtx.close();

  const deanCtx = await signedInContext(browser, removed);
  ids.dean = [
    await createRecipe(deanCtx, { ...SAMPLES.cookie, visibility: 'users' }),
    await createRecipe(deanCtx, SAMPLES.cake),
  ];
  await deanCtx.close();

  const copy = await heirCtx.request.post(`/api/recipes/${ids.dean[0]}/copy`, { headers: ORIGIN });
  expect(copy.status()).toBe(201);
  ids.deanCopy = ((await copy.json()) as { id: string }).id;
});
test.afterAll(async () => {
  await adminCtx?.close();
  await heirCtx?.close();
});

test('deleting a member with "reassign" moves every recipe to the chosen user', async () => {
  // Before: the private recipe is invisible to the heir and the shared one is read-only.
  expect(await apiStatus(heirCtx, ids.dora[0]!)).toBe(404);
  const before = await heirCtx.request.get(`/api/recipes/${ids.dora[1]}`);
  expect(((await before.json()) as { can_edit: boolean }).can_edit).toBe(false);

  await deleteViaUi(ap, reassigned, `${heir.name} (${heir.email})`);

  // After: both are the heir's own (readable and editable), and nothing was lost.
  for (const id of ids.dora) {
    const res = await heirCtx.request.get(`/api/recipes/${id}`);
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { can_edit: boolean }).can_edit).toBe(true);
  }

  // The private recipe is now the heir's own: visible and editable in their book.
  const page = await heirCtx.newPage();
  await page.goto(`/recipes/${ids.dora[0]}`);
  await expect(page.getByRole('heading', { name: SAMPLES.cookie.title })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  await page.close();
});

test('deleting a member with "delete" removes their recipes and keeps copies', async () => {
  await deleteViaUi(ap, removed);

  for (const id of ids.dean) expect(await apiStatus(adminCtx, id)).toBe(404);
  expect(await apiStatus(heirCtx, ids.dean[0]!)).toBe(404);

  // The copy made earlier survives, now without a source.
  const res = await heirCtx.request.get(`/api/recipes/${ids.deanCopy}`);
  expect(res.status()).toBe(200);
  expect(JSON.stringify(await res.json())).toContain('"copied_from_id":null');
});
