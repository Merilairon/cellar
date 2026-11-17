import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, ORIGIN, registerViaInvite, SAMPLES, signIn } from './helpers';
import {
  importedCake,
  linkField,
  linkSwitch,
  makeLink,
  openShare,
  SOURCE_NAME,
  tokenOf,
  TOKEN_PATH,
  turnLinkOn,
} from './share-support';

// T7: sharing end to end (acceptance: "Anonymous user can open a public link and nothing else;
// revoking the link makes it 404 immediately"). The owner works through the Share dialog; the
// anonymous visitor is a fresh browser context with no cookies.
//
// PUBLIC_LINKS_ENABLED=false cannot be toggled per test: it is read once per server process and
// this suite runs one e2e server. That case is covered by unit tests (src/lib/recipes/access.test.ts,
// public.test.ts, the share-link route tests and ShareDialog.test.tsx); the dialog's one-line
// "turned off" state is still exercised here through the server's 403 `public_links_disabled`
// answer in share-a11y.spec.ts.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const owner = account('ownerzulu');
const reader = account('readerzulu');
const NOTE = 'PRIVATE-NOTE-quokka-7731';
const SHARED_NOTE = 'SHARED-NOTE-wombat-4410';

let ownerCtx: BrowserContext;
let readerCtx: BrowserContext;
let op: Page;
let rp: Page;
let id = '';
let url = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, owner);
  await registerViaInvite(browser, reader);
  ownerCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  op = await ownerCtx.newPage();
  await signIn(op, owner);
  readerCtx = await browser.newContext();
  rp = await readerCtx.newPage();
  await signIn(rp, reader);
  id = await createRecipe(ownerCtx, { ...SAMPLES.cake, title: 'Share Flow Cake' });
  // Notes and a rating: none of it may reach the public page.
  for (const [body, shared] of [
    [NOTE, false],
    [SHARED_NOTE, true],
  ] as const) {
    const res = await ownerCtx.request.post(`/api/recipes/${id}/notes`, {
      headers: ORIGIN,
      data: { body, shared },
    });
    expect(res.status()).toBe(201);
  }
  const rate = await ownerCtx.request.put(`/api/recipes/${id}/rating`, {
    headers: ORIGIN,
    data: { stars: 5 },
  });
  expect(rate.ok()).toBe(true);
});
test.afterAll(async () => {
  await ownerCtx?.close();
  await readerCtx?.close();
});

test('owner shares with All users: the reader sees it with the Shared by notice, no Share button', async () => {
  // Private to start with: invisible to the reader.
  expect((await readerCtx.request.get(`/api/recipes/${id}`)).status()).toBe(404);

  await op.goto(`/recipes/${id}`);
  const dialog = await openShare(op);
  await expect(dialog.getByRole('status')).toHaveText('Only you can see this recipe.');
  await dialog.getByRole('radio', { name: 'All users (read-only)' }).check();
  await expect(dialog.getByRole('status')).toHaveText(
    'All users of this Cellar can read this recipe.',
  );
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(op.getByRole('button', { name: 'Share', exact: true })).toBeFocused();
  await expect(op.getByText('All users', { exact: true })).toBeVisible(); // the state chip

  await rp.goto('/recipes');
  await expect(rp.getByRole('link', { name: /Share Flow Cake/ })).toContainText(
    `Shared by ${owner.name}`,
  );
  await rp.goto(`/recipes/${id}`);
  await expect(rp.getByText(`Shared by ${owner.name}.`)).toBeVisible();
  await expect(rp.getByRole('button', { name: 'Save a copy' })).toBeVisible();
  await expect(rp.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(rp.getByRole('button', { name: 'Print' })).toBeVisible();
  // Not through the API either.
  const link = await readerCtx.request.post(`/api/recipes/${id}/share-link`, { headers: ORIGIN });
  expect([403, 404]).toContain(link.status());
});

test('public link on: copy from the field, a cookie-less visitor gets the page and nothing private', async ({
  browser,
}) => {
  await op.goto(`/recipes/${id}`);
  const dialog = await openShare(op);
  url = await turnLinkOn(dialog);
  expect(new URL(url).pathname).toMatch(TOKEN_PATH);
  await expect(dialog.getByRole('status')).toHaveText(
    'All users of this Cellar and anyone with the public link can read this recipe.',
  );
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeFocused();

  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Link copied.');
  expect(await op.evaluate(() => navigator.clipboard.readText())).toBe(url);
  expect(await linkField(dialog).inputValue()).toBe(url);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(op.getByText('All users · Public link')).toBeVisible();

  // Fresh context: no cookies, no storage.
  const guest = await browser.newContext();
  const page = await guest.newPage();
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(`${r.method()} ${r.url()}`);
  });
  const res = await page.goto(url);
  expect(res?.status()).toBe(200);
  const raw = await res!.text();
  await expect(page.getByRole('heading', { level: 1, name: 'Share Flow Cake' })).toBeVisible();
  await expect(page.getByRole('button', { name: '2x', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');

  for (const secret of [
    NOTE,
    SHARED_NOTE,
    owner.name,
    owner.email,
    reader.email,
    'share_token',
    'shareToken',
    'rating_avg',
    'my_rating',
    'owner_id',
    'can_edit',
  ]) {
    expect(raw, `HTML must not contain ${secret}`).not.toContain(secret);
  }
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
  for (const name of [/^Edit/, /^Delete/, /^Save a copy/, /^Cook/, /^Convert/, /^Share/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByText(/Convert/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /sign in|log in/i })).toHaveCount(0);
  expect(apiCalls).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await guest.cookies()).toEqual([]);
  await guest.close();
});

test('New link: the old link 404s, the new one opens', async ({ playwright }) => {
  const anon = await playwright.request.newContext();
  expect((await anon.get(url)).status()).toBe(200);

  await op.goto(`/recipes/${id}`);
  const dialog = await openShare(op);
  await expect(linkField(dialog)).toHaveValue(url); // the dialog shows the stored link
  await dialog.getByRole('button', { name: 'New link' }).click();
  const confirm = dialog.getByRole('group', { name: /Make a new link/ });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused();
  // Nothing sent yet: Keep leaves the link as it was.
  await confirm.getByRole('button', { name: 'Keep' }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'New link' })).toBeFocused();
  expect((await anon.get(url)).status()).toBe(200);

  await dialog.getByRole('button', { name: 'New link' }).click();
  await dialog.getByRole('button', { name: 'Make new link' }).click();
  await expect(dialog.getByRole('status')).toHaveText(
    'New link ready. The old link no longer works.',
  );
  const next = await linkField(dialog).inputValue();
  expect(next).not.toBe(url);
  expect(new URL(next).pathname).toMatch(TOKEN_PATH);
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeFocused();

  expect((await anon.get(url)).status()).toBe(404);
  expect((await anon.get(next)).status()).toBe(200);
  url = next;
  await anon.dispose();
});

test('Turn off: the very next request is a 404, and Escape returns focus to Share', async ({
  playwright,
}) => {
  const anon = await playwright.request.newContext();
  await op.goto(`/recipes/${id}`);
  const dialog = await openShare(op);
  await linkSwitch(dialog).click();
  const confirm = dialog.getByRole('group', { name: /Turn off the public link/ });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Keep' }).click();
  await expect(linkSwitch(dialog)).toBeFocused();
  await expect(linkSwitch(dialog)).toBeChecked();
  expect((await anon.get(url)).status()).toBe(200);

  await linkSwitch(dialog).click();
  await confirm.getByRole('button', { name: 'Turn off' }).click();
  await expect(linkSwitch(dialog)).not.toBeChecked();
  await expect(linkField(dialog)).toHaveCount(0);
  await expect(linkSwitch(dialog)).toBeFocused();
  await expect(dialog.getByRole('status')).toHaveText(
    'All users of this Cellar can read this recipe.',
  );
  // Acceptance: revoking makes it 404 immediately, on the next request.
  expect((await anon.get(url)).status()).toBe(404);

  // Turning it on again makes a different token (the revoked one stays dead).
  const again = await turnLinkOn(dialog);
  expect(tokenOf(again)).not.toBe(tokenOf(url));
  expect((await anon.get(url)).status()).toBe(404);
  expect((await anon.get(again)).status()).toBe(200);

  await op.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(op.getByRole('button', { name: 'Share', exact: true })).toBeFocused();
  await anon.dispose();
});

test('copyright notice: shown for an imported, unedited recipe; not for a hand-made one; gone after an edit', async () => {
  const imported = await createRecipe(ownerCtx, importedCake('Imported Cake'));
  const handmade = await createRecipe(ownerCtx, { ...SAMPLES.cookie, title: 'Hand Made Cookie' });

  await op.goto(`/recipes/${handmade}`);
  let dialog = await openShare(op);
  await expect(dialog.getByRole('note')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();

  await op.goto(`/recipes/${imported}`);
  dialog = await openShare(op);
  const notice = dialog.getByRole('note', { name: 'This recipe was imported and not edited' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(`It came from ${SOURCE_NAME}.`);
  await expect(
    dialog.getByRole('radio', { name: 'All users (read-only)' }),
  ).toHaveAccessibleDescription(/imported and not edited/);
  // Never blocking: the radio and the switch work with the notice showing.
  await dialog.getByRole('radio', { name: 'All users (read-only)' }).check();
  await expect(dialog.getByRole('status')).toHaveText(
    'All users of this Cellar can read this recipe.',
  );
  await turnLinkOn(dialog);
  await expect(notice).toBeVisible(); // no "do not show again"
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Sharing changes do not count as an edit (Q3): still imported and unedited after reload.
  await op.reload();
  dialog = await openShare(op);
  await expect(dialog.getByRole('note')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Rewriting it in the owner's own words removes the warning.
  const put = await ownerCtx.request.put(`/api/recipes/${imported}`, {
    headers: ORIGIN,
    data: { ...importedCake('Imported Cake, rewritten') },
  });
  expect(put.ok()).toBe(true);
  await op.reload();
  dialog = await openShare(op);
  await expect(dialog.getByRole('note')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Without a source name the notice falls back to the host of the source URL.
  const noName = await createRecipe(ownerCtx, {
    ...importedCake('Host Only Cake'),
    source_name: '',
  });
  await op.goto(`/recipes/${noName}`);
  dialog = await openShare(op);
  await expect(dialog.getByRole('note')).toContainText('It came from www.example-kitchen.test.');
});

test('anonymous visitors: /recipes redirects to login, the API answers 401', async ({
  request,
  browser,
}) => {
  const page = await request.get('/recipes', { maxRedirects: 0 });
  expect(page.status()).toBe(307);
  expect(new URL(page.headers()['location'], 'http://x').pathname).toBe('/login');
  const detail = await request.get(`/recipes/${id}`, { maxRedirects: 0 });
  expect(detail.status()).toBe(307);

  for (const [method, path] of [
    ['get', `/api/recipes/${id}`],
    ['get', '/api/recipes'],
    ['post', `/api/recipes/${id}/share-link`],
    ['delete', `/api/recipes/${id}/share-link`],
  ] as const) {
    const res = await request[method](path, { headers: ORIGIN, maxRedirects: 0 });
    expect(res.status(), `${method} ${path}`).toBe(401);
  }

  // A browser lands on the login form.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('/recipes');
  await expect(p).toHaveURL(/\/login/);
  await ctx.close();
});

test('a share link gives access to that recipe only', async ({ browser }) => {
  const other = await createRecipe(ownerCtx, { ...SAMPLES.cookie, title: 'Not Shared Cookie' });
  const link = await makeLink(ownerCtx, other);
  const guest = await browser.newContext();
  const p = await guest.newPage();
  await p.goto(link);
  await expect(p.getByRole('heading', { level: 1, name: 'Not Shared Cookie' })).toBeVisible();
  // The token is no session: the app pages and the recipe API still turn the guest away.
  for (const path of ['/recipes', `/recipes/${other}`, `/api/recipes/${other}`]) {
    const res = await guest.request.get(path, { maxRedirects: 0 });
    expect([307, 401], path).toContain(res.status());
  }
  await guest.close();
});
