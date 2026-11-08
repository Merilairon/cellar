import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  createRecipe,
  hydrated,
  ORIGIN,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';
import {
  apiPhotos,
  apiUpload,
  expectLoaded,
  makeImage,
  SVG_AS_JPG,
  type PhotoRow,
} from './media-support';

// T11 part 1: photo upload, rejection, cover, delete, reader view. Serial; the file owns its users.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const owner = account('phowner');
const reader = account('phreader');
let ownerCtx: BrowserContext;
let readerCtx: BrowserContext;
let sharedId = '';
let privateId = '';
let jpeg: Buffer;
let png: Buffer;
const TITLE = 'Photo Cake';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  jpeg = await makeImage('jpeg', { r: 200, g: 40, b: 40 });
  png = await makeImage('png', { r: 40, g: 40, b: 200 });
  await registerViaInvite(browser, owner);
  await registerViaInvite(browser, reader);
  ownerCtx = await browser.newContext();
  readerCtx = await browser.newContext();
  await signIn(await ownerCtx.newPage(), owner);
  await signIn(await readerCtx.newPage(), reader);
  sharedId = await createRecipe(ownerCtx, { ...SAMPLES.cake, title: TITLE, visibility: 'users' });
  privateId = await createRecipe(ownerCtx, {
    ...SAMPLES.cookie,
    title: 'Photo Private Cookie',
    visibility: 'private',
  });
});
test.afterAll(async () => {
  // Shared recipes would show up in every other member's list and break specs that expect an
  // empty book (recipes.spec.ts), so remove what this file created.
  for (const rid of [sharedId, privateId]) {
    if (rid) await ownerCtx?.request.delete(`/api/recipes/${rid}`, { headers: ORIGIN });
  }
  await ownerCtx?.close();
  await readerCtx?.close();
});

const fileInput = (p: Page) => p.locator('input[type="file"]');
const heroImg = (p: Page) => p.getByRole('img', { name: `Photo of ${TITLE}` });

async function openManager(page: Page) {
  await page.goto(`/recipes/${sharedId}`);
  const toggle = page.getByRole('button', { name: /^Edit photos$|^Add a photo$/ }).first();
  await hydrated(toggle);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByRole('heading', { name: /^Photos \(/ })).toBeVisible();
}

test('owner uploads a jpeg and a png; both appear, the first is the cover on page and card', async () => {
  const page = await ownerCtx.newPage();
  await page.goto(`/recipes/${sharedId}`);
  // Empty state: designed placeholder with the owner prompt, no hero image.
  await expect(page.getByText('No photo yet')).toBeVisible();
  await expect(heroImg(page)).toHaveCount(0);
  await openManager(page);
  await expect(page.getByRole('heading', { name: 'Photos (0 of 10)' })).toBeVisible();

  await fileInput(page).setInputFiles({ name: 'red.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByText('red.jpg: Added. It is now the cover.')).toBeVisible();
  await expectLoaded(heroImg(page));
  await fileInput(page).setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('blue.png: Added')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Photos (2 of 10)' })).toBeVisible();

  const rows = await apiPhotos(ownerCtx, sharedId);
  expect(rows).toHaveLength(2);
  expect(rows.filter((r) => r.is_cover)).toHaveLength(1);
  const cover = rows.find((r) => r.is_cover)!;
  await expect(heroImg(page)).toHaveAttribute('src', `/api/photos/${cover.id}`);

  // The card on the list uses the thumbnail of the cover.
  await page.goto('/recipes');
  const thumb = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: TITLE }) })
    .locator('img')
    .first();
  await expect(thumb).toHaveAttribute('src', `/api/photos/${cover.id}?size=thumb`);
  await expectLoaded(thumb);
  await page.close();
});

test('hostile and oversized files are rejected with typed messages and add no row', async () => {
  const page = await ownerCtx.newPage();
  await openManager(page);
  const before = await apiPhotos(ownerCtx, sharedId);

  // SVG renamed .jpg: passes the client pre-check, the server (magic bytes) rejects it.
  await fileInput(page).setInputFiles({
    name: 'evil.jpg',
    mimeType: 'image/jpeg',
    buffer: SVG_AS_JPG,
  });
  await expect(page.getByText(/Problem: evil\.jpg is not a supported image/)).toBeVisible();

  // Right magic, garbage body: unreadable image.
  const truncated = png.subarray(0, 60);
  await fileInput(page).setInputFiles({
    name: 'cut.png',
    mimeType: 'image/png',
    buffer: truncated,
  });
  await expect(page.getByText(/Problem: cut\.png could not be read as an image/)).toBeVisible();

  // Wrong extension and type: refused by the client before any request.
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/photos')) posts++;
  });
  await fileInput(page).setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hi'),
  });
  await expect(page.getByText(/Problem: notes\.txt is not a supported image/)).toBeVisible();

  // 11 MiB: client pre-check message, no request.
  const big = Buffer.alloc(11 * 1024 * 1024, 1);
  await fileInput(page).setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: big });
  await expect(page.getByText(/Problem: huge\.jpg is larger than 10 MB/)).toBeVisible();
  expect(posts).toBe(0);

  expect(await apiPhotos(ownerCtx, sharedId)).toEqual(before);
  await expect(
    page.getByRole('heading', { name: `Photos (${before.length} of 10)` }),
  ).toBeVisible();

  // Server is authoritative: the same oversized body sent directly is a 413, a hostile one a 422.
  const res = await apiUpload(ownerCtx, sharedId, big, 'image/jpeg');
  expect(res.status()).toBe(413);
  const svg = await apiUpload(ownerCtx, sharedId, SVG_AS_JPG, 'image/jpeg');
  expect(svg.status()).toBe(422);
  expect(await apiPhotos(ownerCtx, sharedId)).toEqual(before);
  await page.close();
});

test('set cover moves the badge, the hero and the card; delete asks first', async () => {
  const page = await ownerCtx.newPage();
  await openManager(page);
  let rows = await apiPhotos(ownerCtx, sharedId);
  const other = rows.find((r) => !r.is_cover)!;
  const idx = rows.findIndex((r) => r.id === other.id) + 1;

  await page.getByRole('button', { name: `Make cover (Photo ${idx} of 2)` }).click();
  await expect(page.getByText(`Photo ${idx} of 2 is now the cover.`)).toBeVisible();
  await expect
    .poll(async () => (await apiPhotos(ownerCtx, sharedId)).find((r) => r.is_cover)?.id)
    .toBe(other.id);
  await expect(heroImg(page)).toHaveAttribute('src', `/api/photos/${other.id}`);
  await page.goto('/recipes');
  await expect(
    page
      .getByRole('main')
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: TITLE }) })
      .locator('img')
      .first(),
  ).toHaveAttribute('src', `/api/photos/${other.id}?size=thumb`);

  // Delete: Keep changes nothing, Delete removes; the server promotes the other photo.
  await openManager(page);
  const del = page.getByRole('button', { name: /^Delete \(Photo 1 of 2\)/ });
  await del.click();
  await expect(page.getByText('Delete this photo? This cannot be undone.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep' }).click();
  expect(await apiPhotos(ownerCtx, sharedId)).toHaveLength(2);
  await del.click();
  await page
    .getByRole('group', { name: 'Delete this photo? This cannot be undone.' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText(/Photo deleted\./)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Photos (1 of 10)' })).toBeVisible();
  rows = await apiPhotos(ownerCtx, sharedId);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.is_cover).toBe(true);
  await page.close();
});

test('reader sees the photo but no controls; private photo and anonymous access are refused', async ({
  browser,
}) => {
  const page = await readerCtx.newPage();
  await page.goto(`/recipes/${sharedId}`);
  await expectLoaded(heroImg(page));
  await expect(
    page.getByRole('button', { name: /Edit photos|Add a photo|Add photos/ }),
  ).toHaveCount(0);
  await expect(fileInput(page)).toHaveCount(0);
  await page.close();

  const rows: PhotoRow[] = await apiPhotos(ownerCtx, sharedId);
  const photoId = rows[0]!.id;
  // Reader may not write.
  const w = await readerCtx.request.delete(`/api/photos/${photoId}`, {
    headers: { origin: 'http://localhost:3100' },
  });
  expect([403, 404]).toContain(w.status());
  expect((await readerCtx.request.get(`/api/photos/${photoId}`)).status()).toBe(200);

  // Photo of a private recipe: invisible to the reader.
  const priv = await apiUpload(ownerCtx, privateId, jpeg, 'image/jpeg');
  expect(priv.status()).toBe(201);
  const privPhoto = (await priv.json()) as { id: string };
  expect((await readerCtx.request.get(`/api/photos/${privPhoto.id}`)).status()).toBe(404);
  expect((await ownerCtx.request.get(`/api/photos/${privPhoto.id}`)).status()).toBe(200);

  const anon = await browser.newContext();
  expect((await anon.request.get(`/api/photos/${photoId}`)).status()).toBe(401);
  await anon.close();
});
