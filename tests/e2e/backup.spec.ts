import { expect, test, type BrowserContext } from '@playwright/test';
import { readdirSync } from 'node:fs';
import sharp from 'sharp';
import { rawZip } from '@/lib/backup/unzip-test-util';
import { account, ADMIN, createRecipe, registerViaInvite, SAMPLES, signIn } from './helpers';
import {
  backupReady,
  BASE_A,
  BASE_B,
  chooseAndCheck,
  countsOf,
  getNotes,
  getTree,
  inviteAt,
  listTitles,
  newContextAt,
  ORIGIN_A,
  ORIGIN_B,
  readExportZip,
  restoreAlert,
  setupAdmin,
  signInAt,
  stripNotes,
  stripTree,
  type BackupDoc,
} from './backup-support';
import { apiUpload, makeImage, apiPhotos } from './media-support';
import { listRecipe, makeLink, tokenOf } from './share-support';

// T12: "Export from instance A and restore into a fresh instance B yields identical recipes
// (grid spans included)". A is the :3100 server every other spec uses; B is the fourth
// webServer (:3103: same build, own DB, uploads and restore directory). The file owns its
// users on A and deletes its recipes afterwards (shared recipes would show in other specs'
// lists); B is only ever used here. Session cookies ignore ports, so A and B contexts are
// always separate. The `skip`/`rename` repeat, the rejections and the CSRF checks use the API;
// the main happy path (file input -> preview -> strategy -> restore -> result) is driven through
// the /backup page twice (admin all-zip, member own-zip).
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const member = account('bkmember');
const mover = account('bkmover'); // a different member on B: the own-scope zip restores into any account
const NOTE = {
  adminPrivate: 'BK-admin-private-note-4821',
  adminShared: 'BK-admin-shared-note-9173',
  memberPrivate: 'BK-member-private-note-3305',
  memberShared: 'BK-member-shared-note-7742',
  memberOnOwn: 'BK-member-own-recipe-note-1156',
  adminOnMember: 'BK-admin-note-on-member-recipe-6609',
};
const T = {
  cookie: SAMPLES.cookie.title,
  cake: SAMPLES.cake.title,
  mCake: 'Member Cake',
  mCookie: 'Member Cookie',
};

let adminA: BrowserContext;
let memberA: BrowserContext;
let adminB: BrowserContext;
let memberB: BrowserContext;
let moverB: BrowserContext;
const idsA: Record<keyof typeof T, string> = { cookie: '', cake: '', mCake: '', mCookie: '' };
let shareUrl = '';
let memberJson: Buffer;
let memberZip: Buffer;
let adminZip: Buffer;
let adminDoc: BackupDoc;
let memberDoc: BackupDoc;

const stageFiles = () => {
  try {
    return readdirSync('data/e2e-b-restore');
  } catch {
    return [];
  }
};

async function note(ctx: BrowserContext, id: string, body: string, shared: boolean) {
  const res = await ctx.request.post(`/api/recipes/${id}/notes`, {
    headers: ORIGIN_A,
    data: { body, shared },
  });
  expect(res.status()).toBe(201);
}
async function rate(ctx: BrowserContext, id: string, stars: number) {
  const res = await ctx.request.put(`/api/recipes/${id}/rating`, {
    headers: ORIGIN_A,
    data: { stars },
  });
  expect(res.ok()).toBe(true);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  // ---- instance A: users, recipes, photos, notes, ratings, a public link ----
  await registerViaInvite(browser, member);
  adminA = await browser.newContext();
  await signIn(await adminA.newPage(), ADMIN);
  memberA = await browser.newContext();
  await signIn(await memberA.newPage(), member);

  idsA.cake = await createRecipe(adminA, {
    ...SAMPLES.cake,
    visibility: 'users',
    tags: ['baking', 'dessert'],
  });
  idsA.cookie = await createRecipe(adminA, { ...SAMPLES.cookie, tags: ['chocolate'] });
  idsA.mCake = await createRecipe(memberA, {
    ...SAMPLES.cake,
    title: T.mCake,
    visibility: 'users',
    tags: ['baking', 'family'],
  });
  idsA.mCookie = await createRecipe(memberA, listRecipe(T.mCookie));

  const jpeg = await makeImage('jpeg', { r: 200, g: 40, b: 40 }, 640, 480);
  const png = await makeImage('png', { r: 40, g: 40, b: 200 }, 320, 240);
  const up = async (ctx: BrowserContext, id: string, bytes: Buffer, type: string) =>
    expect((await apiUpload(ctx, id, bytes, type)).status()).toBe(201);
  await up(adminA, idsA.cake, jpeg, 'image/jpeg');
  await up(adminA, idsA.cake, png, 'image/png');
  // The second photo becomes the cover, so "cover flag" is not just "first photo".
  const cakePhotos = await apiPhotos(adminA, idsA.cake);
  const second = cakePhotos.find((p) => !p.is_cover)!;
  const cover = await adminA.request.put(`/api/recipes/${idsA.cake}/photos/${second.id}/cover`, {
    headers: ORIGIN_A,
  });
  expect(cover.ok()).toBe(true);
  await up(adminA, idsA.cookie, jpeg, 'image/jpeg');
  await up(memberA, idsA.mCake, png, 'image/png');
  await up(memberA, idsA.mCake, jpeg, 'image/jpeg');
  // Member Cookie has no photo on purpose.

  await note(adminA, idsA.cake, NOTE.adminPrivate, false);
  await note(adminA, idsA.cake, NOTE.adminShared, true);
  await note(memberA, idsA.cake, NOTE.memberShared, true);
  await note(memberA, idsA.cake, NOTE.memberPrivate, false);
  await note(memberA, idsA.mCake, NOTE.memberOnOwn, false);
  await note(adminA, idsA.mCake, NOTE.adminOnMember, true);
  await rate(adminA, idsA.cake, 5);
  await rate(memberA, idsA.cake, 3);
  await rate(adminA, idsA.cookie, 4);
  await rate(memberA, idsA.mCake, 4);
  await rate(adminA, idsA.mCake, 2);
  shareUrl = await makeLink(adminA, idsA.cake);

  // ---- instance B: fresh; admin and member with the SAME emails as on A (owner mapping), plus a mover ----
  await setupAdmin(browser, BASE_B, ADMIN);
  await inviteAt(browser, BASE_B, ADMIN, member);
  await inviteAt(browser, BASE_B, ADMIN, mover);
  adminB = await signInAt(browser, BASE_B, ADMIN);
  memberB = await signInAt(browser, BASE_B, member);
  moverB = await signInAt(browser, BASE_B, mover);
});

test.afterAll(async () => {
  for (const [ctx, id] of [
    [adminA, idsA.cake],
    [adminA, idsA.cookie],
    [memberA, idsA.mCake],
    [memberA, idsA.mCookie],
  ] as const) {
    if (id) await ctx?.request.delete(`/api/recipes/${id}`, { headers: ORIGIN_A });
  }
  for (const c of [adminA, memberA, adminB, memberB, moverB]) await c?.close();
});

test('A: the member exports JSON and zip, the admin exports everything (no token, right scope)', async () => {
  const json = await memberA.request.get('/api/export');
  expect(json.status()).toBe(200);
  memberJson = await json.body();
  memberDoc = JSON.parse(memberJson.toString('utf8')) as BackupDoc;
  expect(memberDoc.scope).toBe('own');
  expect(memberDoc.recipes.map((r) => r.title).sort()).toEqual([T.mCake, T.mCookie]);

  const zip = await memberA.request.get('/api/export?photos=1');
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toBe('application/zip');
  memberZip = await zip.body();
  const mz = readExportZip(memberZip);
  expect(mz.doc.recipes.map((r) => r.title).sort()).toEqual([T.mCake, T.mCookie]);
  expect(mz.names.filter((n) => n.startsWith('photos/')).length).toBeGreaterThanOrEqual(2);

  // A member may not ask for everyone's data.
  expect((await memberA.request.get('/api/export?all=1')).status()).toBe(403);

  const all = await adminA.request.get('/api/export?all=1&photos=1');
  expect(all.status()).toBe(200);
  adminZip = await all.body();
  const az = readExportZip(adminZip);
  adminDoc = az.doc;
  expect(adminDoc.scope).toBe('all');
  const titles = adminDoc.recipes.map((r) => r.title);
  for (const t of Object.values(T)) expect(titles).toContain(t);

  // R8: the public token is in no export, JSON or zip.
  const token = tokenOf(shareUrl);
  for (const raw of [memberJson, adminZip, memberZip]) {
    expect(raw.includes(Buffer.from(token))).toBe(false);
  }
  expect(JSON.stringify(adminDoc)).not.toMatch(/password|share_token/i);
});

test('B: the admin restores the all-users zip through /backup; the preview equals what A exported', async () => {
  const expected = countsOf(adminDoc);
  expect(expected.recipes).toBeGreaterThanOrEqual(4);
  expect(expected.photos).toBe(5); // 2 + 1 + 2 + 0
  const page = await adminB.newPage();
  await backupReady(page);

  await chooseAndCheck(page, {
    name: 'cellar-backup-all.zip',
    mimeType: 'application/zip',
    buffer: adminZip,
  });
  const caption = page.getByText('Backup contents', { exact: true });
  await expect(caption).toBeFocused();
  const row = (label: string, n: number) =>
    expect(page.getByRole('row', { name: new RegExp(`^${label}\\s+${n}$`) })).toBeVisible();
  await row('Recipes', expected.recipes);
  await row('Sections', expected.sections);
  await row('Notes', expected.notes);
  await row('Ratings', expected.ratings);
  await row('Photos', expected.photos);
  await expect(page.getByText('Backup of: all users')).toBeVisible();
  // Fresh instance B: nothing exists yet, and every owner email maps to a B user.
  await expect(page.getByRole('heading', { name: /^Already in your recipes/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Owners not found here/ })).toHaveCount(0);

  await expect(page.getByRole('radio', { name: 'Skip them and keep mine' })).toBeChecked();
  await page.getByRole('button', { name: `Restore ${expected.recipes} recipes` }).click();

  const heading = page.getByRole('heading', { name: 'Restore finished' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText(`${expected.recipes} recipes restored`)).toBeVisible();
  await expect(page.getByText(`${expected.photos} photos restored`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open my recipes' })).toBeVisible();
  expect(stageFiles()).toEqual([]); // applying consumed the staged upload
  await page.close();
});

test('B vs A: recipe trees, notes, ratings and photos are identical (grid spans included)', async () => {
  const owners: Array<[string, BrowserContext, BrowserContext, BrowserContext, BrowserContext]> = [
    // title, A owner, B owner, A other viewer, B other viewer
    [T.cake, adminA, adminB, memberA, memberB],
    [T.cookie, adminA, adminB, adminA, adminB],
    [T.mCake, memberA, memberB, adminA, adminB],
    [T.mCookie, memberA, memberB, memberA, memberB],
  ];
  const aIds: Record<string, string> = {
    [T.cake]: idsA.cake,
    [T.cookie]: idsA.cookie,
    [T.mCake]: idsA.mCake,
    [T.mCookie]: idsA.mCookie,
  };
  let spans = 0;
  let photos = 0;
  for (const [title, aOwner, bOwner, aViewer, bViewer] of owners) {
    const bRows = (await listTitles(bOwner)).filter((r) => r.title === title);
    expect(bRows, `${title} exists once on B`).toHaveLength(1);
    const bId = bRows[0]!.id;
    expect(bId).not.toBe(aIds[title]);

    const a = await getTree(aOwner, aIds[title]!);
    const b = await getTree(bOwner, bId);
    expect(stripTree(b), `${title}: tree`).toEqual(stripTree(a));

    // Spot checks that the equality above is not vacuous.
    const sections = (a.sections as Array<{ steps: Array<Record<string, unknown>> }>) ?? [];
    for (const s of sections) for (const st of s.steps) if (st.row_start !== null) spans++;
    photos += (a.photos as unknown[]).length;
    expect((b.share as { enabled: boolean }).enabled).toBe(false); // links are never restored

    // Notes: what the owner sees and what the other viewer sees (shared only, plus their own).
    const sortBody = (n: Array<{ body: unknown }>) =>
      [...n].sort((x, y) => String(x.body).localeCompare(String(y.body)));
    expect(sortBody(stripNotes(await getNotes(bOwner, bId)) as never)).toEqual(
      sortBody(stripNotes(await getNotes(aOwner, aIds[title]!)) as never),
    );
    expect(sortBody(stripNotes(await getNotes(bViewer, bId)) as never)).toEqual(
      sortBody(stripNotes(await getNotes(aViewer, aIds[title]!)) as never),
    );
  }
  expect(spans).toBeGreaterThan(10); // both samples carry grid spans, and they survived
  expect(photos).toBe(5);

  // Private stays private on B: the member cannot read the admin's private cookie recipe.
  const cookieB = (await listTitles(adminB)).find((r) => r.title === T.cookie)!;
  expect((await memberB.request.get(`/api/recipes/${cookieB.id}`)).status()).toBe(404);

  // Explicit rating and visibility facts for the cake (5 + 3 stars), not just "A equals B".
  const cakeB = (await listTitles(adminB)).find((r) => r.title === T.cake)!;
  const cake = await getTree(adminB, cakeB.id);
  expect(cake.rating_count).toBe(2);
  expect(cake.rating_avg).toBe(4);
  expect(cake.my_rating).toBe(5);
  expect(cake.visibility).toBe('users');
  expect(cake.view_mode).toBe('grid');
  const listM = (await listTitles(memberB)).find((r) => r.title === T.mCookie)!;
  expect((await getTree(memberB, listM.id)).view_mode).toBe('list');
});

test("B serves the restored photos from its own /api/photos/:id, re-encoded as webp, with A's cover flag", async ({
  browser,
}) => {
  const anon = await newContextAt(browser, BASE_B);
  const cakeB = (await listTitles(adminB)).find((r) => r.title === T.cake)!;
  const treeB = await getTree(adminB, cakeB.id);
  const photosB = treeB.photos as Array<{
    id: string;
    width: number;
    height: number;
    is_cover: boolean;
  }>;
  const photosA = await apiPhotos(adminA, idsA.cake);
  expect(photosB).toHaveLength(2);
  expect(photosB.map((p) => p.is_cover)).toEqual(photosA.map((p) => p.is_cover));
  expect(photosB.filter((p) => p.is_cover)).toHaveLength(1);
  const coverIdA = photosA.find((p) => p.is_cover)!.id;
  expect(photosB.some((p) => p.id === coverIdA)).toBe(false); // new ids: nothing points back at A
  for (const p of photosB) {
    for (const size of ['', '?size=thumb']) {
      const res = await adminB.request.get(`/api/photos/${p.id}${size}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/webp');
      const meta = await sharp(await res.body()).metadata();
      expect(meta.format).toBe('webp');
      if (!size) expect([meta.width, meta.height]).toEqual([p.width, p.height]);
    }
    // A visitor without a session gets nothing.
    expect((await anon.request.get(`/api/photos/${p.id}`)).status()).toBe(401);
  }
});

test('B: the same zip again with skip skips everything; with rename every title gets " (restored)"', async () => {
  const expected = countsOf(adminDoc);
  const stage = async () => {
    const res = await adminB.request.post('/api/import/backup', {
      headers: { ...ORIGIN_B, 'content-type': 'application/zip' },
      data: adminZip,
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as {
      id: string;
      preview: { recipes: number; conflicts: Array<{ title: string }>; unknown_users: string[] };
    };
  };
  const apply = async (id: string, strategy: string) => {
    const res = await adminB.request.post(`/api/import/backup/${id}/apply`, {
      headers: ORIGIN_B,
      data: { strategy },
    });
    expect(res.status()).toBe(200);
    return (await res.json()) as Record<string, number | null>;
  };
  const countAll = async () =>
    (await listTitles(adminB)).length + (await listTitles(memberB)).length;

  const before = await countAll();
  const s1 = await stage();
  expect(s1.preview.recipes).toBe(expected.recipes);
  expect(s1.preview.conflicts).toHaveLength(expected.recipes); // all exist, per target owner
  expect(s1.preview.unknown_users).toEqual([]);
  const skipped = await apply(s1.id, 'skip');
  expect(skipped).toMatchObject({
    imported: 0,
    renamed: 0,
    skipped: expected.recipes,
    photos_restored: 0,
    failed_at: null,
  });
  expect(await countAll()).toBe(before);

  const s2 = await stage();
  const renamed = await apply(s2.id, 'rename');
  // `imported` counts every restored recipe, copies included; `renamed` is the subset.
  expect(renamed).toMatchObject({
    imported: expected.recipes,
    renamed: expected.recipes,
    skipped: 0,
    photos_restored: expected.photos,
    failed_at: null,
  });
  const adminTitles = (await listTitles(adminB)).map((r) => r.title);
  const memberTitles = (await listTitles(memberB)).map((r) => r.title);
  for (const t of [T.cake, T.cookie]) expect(adminTitles).toContain(`${t} (restored)`);
  for (const t of [T.mCake, T.mCookie]) expect(memberTitles).toContain(`${t} (restored)`);
  // A copy carries the photos and the grid of its original.
  const copy = (await listTitles(adminB)).find((r) => r.title === `${T.cake} (restored)`)!;
  const orig = (await listTitles(adminB)).find((r) => r.title === T.cake)!;
  const [tc, to] = [await getTree(adminB, copy.id), await getTree(adminB, orig.id)];
  expect((tc.photos as unknown[]).length).toBe(2);
  expect(stripTree({ ...tc, title: T.cake })).toEqual(stripTree(to));
  expect(stageFiles()).toEqual([]);
});

test("B: another member restores A's member zip through /backup; only own recipes, other users' notes are dropped", async () => {
  const own = memberDoc.recipes.reduce(
    (n, r) => n + r.notes.filter((x) => x.mine === true).length,
    0,
  );
  const others = memberDoc.recipes.reduce(
    (n, r) => n + r.notes.filter((x) => x.mine === false).length,
    0,
  );
  expect(own).toBe(1); // the member's note on their own Member Cake
  expect(others).toBe(1); // the admin's shared note on Member Cake
  const page = await moverB.newPage();
  await backupReady(page);
  await expect(page.getByLabel("Include all users' recipes")).toHaveCount(0); // admin only

  await chooseAndCheck(page, {
    name: 'cellar-backup-member.zip',
    mimeType: 'application/zip',
    buffer: memberZip,
  });
  await expect(page.getByText('Backup contents', { exact: true })).toBeFocused();
  await expect(page.getByRole('row', { name: /^Recipes\s+2$/ })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`^Notes\\s+${own}$`) })).toBeVisible();
  await expect(page.getByRole('row', { name: /^Ratings\s+1$/ })).toBeVisible();
  await expect(page.getByText('Backup of: your recipes')).toBeVisible();
  await expect(
    page.getByText('Shared notes written by other users are left out; they need an account here.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Already in your recipes/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore 2 recipes' }).click();
  await expect(page.getByRole('heading', { name: 'Restore finished' })).toBeFocused();
  await expect(page.getByText('2 recipes restored')).toBeVisible();
  await expect(page.getByText('1 note left out')).toBeVisible();
  await page.close();

  // The list also shows other users' shared recipes; the restore must have added only the mover's own.
  const rows = (await listTitles(moverB)).filter((r) => r.owner_display_name === mover.name);
  expect(rows.map((r) => r.title).sort()).toEqual([T.mCake, T.mCookie]); // nothing of the admin's
  for (const [title, aId] of [
    [T.mCake, idsA.mCake],
    [T.mCookie, idsA.mCookie],
  ] as const) {
    const bId = rows.find((r) => r.title === title)!.id;
    const a = stripTree(await getTree(memberA, aId));
    const b = stripTree(await getTree(moverB, bId));
    // Ratings are the one place a member export differs by design: only the caller's own rating.
    const { rating_avg, rating_count, my_rating, ...aRest } = a as Record<string, unknown>;
    const {
      rating_avg: bAvg,
      rating_count: bCount,
      my_rating: bMine,
      ...bRest
    } = b as Record<string, unknown>;
    void rating_avg;
    void rating_count;
    expect(bRest, `${title}: tree`).toEqual(aRest);
    expect(bMine).toBe(my_rating);
    expect(bCount).toBe(my_rating === null ? 0 : 1);
    expect(bAvg).toBe(my_rating);
    // Own notes (private and shared) come back as the mover's; the admin's note does not.
    const bNotes = stripNotes(await getNotes(moverB, bId));
    const bodies = bNotes.map((n) => n.body);
    expect(bodies).not.toContain(NOTE.adminOnMember);
    expect(bNotes.every((n) => n.mine === true && n.author === mover.name)).toBe(true);
    const aMine = stripNotes(await getNotes(memberA, aId)).filter((n) => n.mine);
    expect(bNotes.map((n) => [n.body, n.shared]).sort()).toEqual(
      aMine.map((n) => [n.body, n.shared]).sort(),
    );
  }
  expect(stageFiles()).toEqual([]);
});

test('B: a version 2 file, a zip with a traversal entry, garbage and an oversize upload are refused with the right message', async () => {
  const page = await moverB.newPage();
  await backupReady(page);
  const doc = { ...memberDoc, version: 2 };
  const post = (data: Buffer, type: string) =>
    moverB.request.post('/api/import/backup', {
      headers: { ...ORIGIN_B, 'content-type': type },
      data,
    });

  // version 2 (R7): through the page, then the API contract.
  await chooseAndCheck(page, {
    name: 'cellar-backup-v2.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(restoreAlert(page)).toContainText(
    'This backup was made by a newer Cellar. Upgrade this instance first.',
  );
  await expect(restoreAlert(page)).toContainText('(backup version 2)');
  const v2 = await post(Buffer.from(JSON.stringify(doc)), 'application/json');
  expect(v2.status()).toBe(422);
  expect(await v2.json()).toMatchObject({ error: 'backup_version_unsupported', found: 2 });

  // A zip whose entry name climbs out of the archive.
  const evil = rawZip([
    { name: 'backup.json', data: Buffer.from(JSON.stringify(memberDoc)) },
    { name: '../../evil.webp', data: Buffer.from('x') },
  ]);
  await page.getByRole('button', { name: 'Check the file' }).waitFor();
  await chooseAndCheck(page, { name: 'evil.zip', mimeType: 'application/zip', buffer: evil });
  await expect(restoreAlert(page)).toContainText(/zip file/i);
  const z = await post(evil, 'application/zip');
  expect(z.status()).toBe(422);
  expect((await z.json()).error).toBe('backup_zip_invalid');

  // A zip with no backup.json, and a JSON that is not a backup.
  const empty = rawZip([{ name: 'readme.txt', data: Buffer.from('hi') }]);
  expect((await post(empty, 'application/zip')).status()).toBe(422);
  const junk = await post(Buffer.from('{"hello":1}'), 'application/json');
  expect(junk.status()).toBe(422);
  expect((await junk.json()).error).toBe('backup_invalid');
  expect((await post(Buffer.from('x'), 'text/plain')).status()).toBe(415);

  // A member cannot restore the all-users file.
  const forbidden = await post(adminZip, 'application/zip');
  expect(forbidden.status()).toBe(403);
  expect((await forbidden.json()).error).toBe('forbidden');

  // 413: B runs with RESTORE_BODY_MAX=2 MiB (playwright.config.ts). The server refuses a declared
  // length over the cap before reading a byte; the page refuses it before any request.
  const big = await post(Buffer.alloc(3 * 1024 * 1024), 'application/zip');
  expect(big.status()).toBe(413);
  expect((await big.json()).error).toBe('backup_too_large');
  let posted = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/import/backup')) posted++;
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'huge.zip',
    mimeType: 'application/zip',
    buffer: Buffer.alloc(3 * 1024 * 1024),
  });
  await expect(restoreAlert(page)).toContainText(
    'This file is larger than 2 MB, the most this Cellar accepts.',
  );
  expect(posted).toBe(0);
  expect(stageFiles()).toEqual([]); // no refusal left a file behind
  await page.close();
});

test('the public link from A does not exist on B', async ({ browser }) => {
  const token = tokenOf(shareUrl);
  const anonA = await newContextAt(browser, BASE_A);
  const anonB = await newContextAt(browser, BASE_B);
  expect((await anonA.request.get(`/r/${token}`)).status()).toBe(200); // control: valid on A
  expect((await anonB.request.get(`/r/${token}`)).status()).toBe(404);
  await anonA.close();
  await anonB.close();
});

test('discard removes the staged file; apply after discard is 404', async () => {
  const before = stageFiles();
  const res = await moverB.request.post('/api/import/backup', {
    headers: { ...ORIGIN_B, 'content-type': 'application/json' },
    data: memberJson,
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  expect(stageFiles()).toHaveLength(before.length + 1);

  // Someone else cannot see, discard or apply it (uniform 404).
  for (const other of [memberB, adminB]) {
    expect(
      (await other.request.delete(`/api/import/backup/${id}`, { headers: ORIGIN_B })).status(),
    ).toBe(404);
    expect(
      (
        await other.request.post(`/api/import/backup/${id}/apply`, {
          headers: ORIGIN_B,
          data: { strategy: 'skip' },
        })
      ).status(),
    ).toBe(404);
  }
  expect(stageFiles()).toHaveLength(before.length + 1);

  expect(
    (await moverB.request.delete(`/api/import/backup/${id}`, { headers: ORIGIN_B })).status(),
  ).toBe(204);
  expect(stageFiles()).toEqual(before);
  const again = await moverB.request.post(`/api/import/backup/${id}/apply`, {
    headers: ORIGIN_B,
    data: { strategy: 'skip' },
  });
  expect(again.status()).toBe(404);
  expect(
    (await moverB.request.delete(`/api/import/backup/${id}`, { headers: ORIGIN_B })).status(),
  ).toBe(404);
  // An invalid strategy never consumes the stage.
  const staged = await moverB.request.post('/api/import/backup', {
    headers: { ...ORIGIN_B, 'content-type': 'application/json' },
    data: memberJson,
  });
  const sid = ((await staged.json()) as { id: string }).id;
  const bad = await moverB.request.post(`/api/import/backup/${sid}/apply`, {
    headers: ORIGIN_B,
    data: { strategy: 'overwrite' },
  });
  expect(bad.status()).toBe(400);
  expect(
    (await moverB.request.delete(`/api/import/backup/${sid}`, { headers: ORIGIN_B })).status(),
  ).toBe(204);
});

test('unauthenticated and cross-origin requests are rejected', async ({ browser }) => {
  const anon = await newContextAt(browser, BASE_B);
  const body = { 'content-type': 'application/json' };
  const stage = await anon.request.post('/api/import/backup', {
    headers: { ...ORIGIN_B, ...body },
    data: memberJson,
  });
  expect(stage.status()).toBe(401);
  expect(
    (
      await anon.request.post('/api/import/backup/01ARZ3NDEKTSV4RRFFQ69G5FAV/apply', {
        headers: ORIGIN_B,
        data: { strategy: 'skip' },
      })
    ).status(),
  ).toBe(401);
  expect((await anon.request.get('/api/export')).status()).toBe(401);
  await anon.close();

  // A signed-in session with a foreign Origin (CSRF) is refused before anything is read.
  for (const origin of ['http://evil.example', BASE_A]) {
    const res = await moverB.request.post('/api/import/backup', {
      headers: { origin, ...body },
      data: memberJson,
    });
    expect(res.status(), origin).toBe(403);
  }
  const noOrigin = await moverB.request.post('/api/import/backup', {
    headers: body,
    data: memberJson,
  });
  expect([403]).toContain(noOrigin.status());
  expect(stageFiles()).toEqual([]);
});
