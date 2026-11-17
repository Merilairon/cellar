import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { rawZip } from '@/lib/backup/unzip-test-util';
import {
  account,
  ADMIN,
  createRecipe,
  expectNoAxeViolations,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';
import {
  allDoc,
  backupReady,
  chooseAndCheck,
  deleteOwned,
  docRecipe,
  freshDoc,
  holdOnce,
  jsonFile,
  mockOnce,
  ownDoc,
  photoZip,
  restoreAlert,
  stage,
} from './backup-support';

// T12: axe (WCAG 2.0 and 2.1 A/AA tags, as every other spec; 2.2 target size is not in the tag set) on every state of /backup (UX spec section 5 and the states table
// in section 6): export (member and admin), the restore picker, upload in flight, preview (no
// conflicts, conflicts with the long list, nothing-to-restore, unknown owners), restoring, result
// (plain, copies, partial), and each error of the 5.4 table, in light and dark at 375 and 1280;
// plus the keyboard path of 5.5. Axe finds a fraction of the issues; screen readers are NOT
// covered here (T16 / owner try).
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const member = account('bka11y');
const PREFIX = 'BkA11y';
let memberCtx: BrowserContext;
let adminCtx: BrowserContext;
let page: Page;

const VIEWS = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
] as const;

/** Axe in light and dark at both widths for the page as it stands now. */
async function audit(p: Page) {
  for (const v of VIEWS) {
    await p.setViewportSize(v);
    for (const scheme of ['light', 'dark'] as const) {
      await p.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(p);
    }
  }
  await p.emulateMedia({ colorScheme: 'light' });
}

const PICK = 'input[type="file"]';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, member);
  memberCtx = await browser.newContext();
  await signIn(await memberCtx.newPage(), member);
  adminCtx = await browser.newContext();
  await signIn(await adminCtx.newPage(), ADMIN);
  // Recipes the member already has, so the "already in your recipes" list is real (7: the list
  // shows five and a "Show all 7" disclosure).
  for (let i = 1; i <= 7; i++) {
    await createRecipe(memberCtx, { ...SAMPLES.cookie, title: `${PREFIX} Existing ${i}` });
  }
});

test.afterAll(async () => {
  await deleteOwned(memberCtx, member.name, PREFIX);
  await deleteOwned(adminCtx, ADMIN.name, PREFIX);
  await page?.close();
  await memberCtx?.close();
  await adminCtx?.close();
});

test.beforeEach(async () => {
  await page?.close();
  page = await memberCtx.newPage();
  await backupReady(page);
});

test('export: member and admin, checkboxes toggled', async () => {
  await audit(page);
  await page.getByRole('checkbox', { name: /Include photos/ }).check();
  await expect(page.getByRole('link', { name: 'Download backup' })).toHaveAttribute(
    'href',
    '/api/export?photos=1',
  );
  await audit(page);
  await expect(page.getByRole('checkbox', { name: /all users/i })).toHaveCount(0);

  const admin = await adminCtx.newPage();
  await backupReady(admin);
  await audit(admin);
  await admin.getByRole('checkbox', { name: /Include all users/ }).check();
  await admin.getByRole('checkbox', { name: /Include photos/ }).check();
  await expect(admin.getByRole('link', { name: 'Download backup' })).toHaveAttribute(
    'href',
    '/api/export?all=1&photos=1',
  );
  await audit(admin);
  await admin.close();
});

test('restore: initial (Check disabled with its reason) and file chosen', async () => {
  await expect(page.getByText('Choose a file first')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check the file' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await audit(page);
  await page.locator(PICK).setInputFiles(jsonFile('cellar-backup-2026-11-15.json', freshDoc('x')));
  await expect(page.getByText('cellar-backup-2026-11-15.json,')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check the file' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await audit(page);
});

test('restore: upload in flight (busy region, status, Cancel)', async () => {
  const release = await holdOnce(page, /\/api\/import\/backup$/, 'POST');
  await page
    .locator(PICK)
    .setInputFiles(jsonFile('cellar-backup-2026-11-15.json', freshDoc(`${PREFIX} Busy`)));
  await page.getByRole('button', { name: 'Check the file' }).click();
  const region = page.getByRole('region', { name: 'Restore' });
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(region.getByRole('status')).toContainText(/Uploading… \d+ %|Checking the file…/);
  await expect(region.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await audit(page);
  release();
  await expect(page.getByText('Backup contents', { exact: true })).toBeFocused();
  await expect(region).toHaveAttribute('aria-busy', 'false');
});

test('restore: preview with no conflicts (skip and rename selected), notes of others left out', async () => {
  await stage(page, jsonFile('f.json', freshDoc(`${PREFIX} Fresh A`)));
  await expect(page.getByRole('button', { name: 'Restore 2 recipes' })).toBeVisible();
  await expect(page.getByText(/Shared notes written by other users are left out/)).toBeVisible();
  await audit(page);
  await page.getByRole('radio', { name: /Restore them as copies/ }).check();
  await audit(page);
});

test('restore: preview with conflicts, the long list opened, Restore as copies', async () => {
  const doc = ownDoc([
    ...Array.from({ length: 7 }, (_, i) => docRecipe(`${PREFIX} Existing ${i + 1}`)),
    docRecipe(`${PREFIX} Brand new`),
  ]);
  await stage(page, jsonFile('f.json', doc));
  await expect(page.getByRole('heading', { name: 'Already in your recipes (7)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore 1 recipe' })).toBeVisible();
  await audit(page);
  await page.getByText('Show all 7').click();
  await audit(page);
  await page.getByRole('radio', { name: /Restore them as copies/ }).check();
  await expect(page.getByRole('button', { name: 'Restore 8 recipes' })).toBeVisible();
  await audit(page);
});

test('restore: preview where every recipe exists (Restore disabled with its reason)', async () => {
  await stage(
    page,
    jsonFile(
      'f.json',
      ownDoc([docRecipe(`${PREFIX} Existing 1`), docRecipe(`${PREFIX} Existing 2`)]),
    ),
  );
  const apply = page.getByRole('button', { name: 'Restore 0 recipes' });
  await expect(apply).toHaveAttribute('aria-disabled', 'true');
  await expect(
    page.getByText(
      'Every recipe in this file already exists. Choose Restore as copies to add them.',
    ),
  ).toBeVisible();
  await audit(page);
});

test('restore: admin preview of an all-users file with owners not found here', async () => {
  const admin = await adminCtx.newPage();
  await backupReady(admin);
  const doc = allDoc(
    [
      { email: 'marie.long.address@example.test', name: 'Marie' },
      { email: ADMIN.email, name: ADMIN.name },
    ],
    [
      docRecipe(`${PREFIX} Marie 1`, { owner_email: 'marie.long.address@example.test' }),
      docRecipe(`${PREFIX} Marie 2`, { owner_email: 'marie.long.address@example.test' }),
      docRecipe(`${PREFIX} Admin 1`, { owner_email: ADMIN.email }),
    ],
  );
  await stage(admin, jsonFile('all.json', doc));
  await expect(admin.getByText('Backup of: all users')).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Owners not found here (1)' })).toBeVisible();
  await audit(admin);
  await admin.getByRole('button', { name: 'Cancel' }).click();
  await admin.close();
});

test('restore: restoring (busy, status) then the result with photos, copies and notes left out', async () => {
  await stage(page, {
    name: 'photos.zip',
    mimeType: 'application/zip',
    buffer: await photoZip(`${PREFIX} Zip`),
  });
  const release = await holdOnce(page, /\/api\/import\/backup\/[^/]+\/apply$/, 'POST');
  await page.getByRole('button', { name: 'Restore 2 recipes' }).click();
  const region = page.getByRole('region', { name: 'Restore' });
  await expect(region.getByText(/Restoring…/)).toBeVisible();
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Restore 2 recipes' })).toBeDisabled();
  await audit(page);
  release();
  const heading = page.getByRole('heading', { name: 'Restore finished' });
  await expect(heading).toBeFocused();
  await expect(page.getByText('2 photos restored')).toBeVisible();
  await audit(page);
});

test('restore: result after a fresh file and after copies', async () => {
  await stage(page, jsonFile('f.json', freshDoc(`${PREFIX} Result`)));
  await page.getByRole('button', { name: 'Restore 2 recipes' }).click();
  await expect(page.getByRole('heading', { name: 'Restore finished' })).toBeFocused();
  await expect(page.getByText('1 note left out')).toBeVisible();
  await audit(page);
  await page.getByRole('button', { name: 'Restore another file' }).click();
  await expect(page.locator(PICK)).toBeFocused();

  // The same file again as copies: "2 recipes restored as copies", never also "2 recipes restored".
  await stage(page, jsonFile('f.json', freshDoc(`${PREFIX} Result`)));
  await expect(page.getByRole('heading', { name: 'Already in your recipes (2)' })).toBeVisible();
  await page.getByRole('radio', { name: /Restore them as copies/ }).check();
  await page.getByRole('button', { name: 'Restore 2 recipes' }).click();
  await expect(page.getByRole('heading', { name: 'Restore finished' })).toBeFocused();
  await expect(page.getByText('2 recipes restored as copies')).toBeVisible();
  await expect(page.getByText(/^2 recipes restored$/)).toHaveCount(0);
  await audit(page);
});

test('restore: partial failure result (server stopped at recipe 2 of 3)', async () => {
  await stage(page, jsonFile('f.json', freshDoc(`${PREFIX} Partial`, 3)));
  await mockOnce(page, /\/api\/import\/backup\/[^/]+\/apply$/, 'POST', 200, {
    imported: 1,
    skipped: 0,
    renamed: 0,
    notes_restored: 0,
    notes_skipped: 0,
    ratings_restored: 0,
    ratings_skipped: 0,
    photos_restored: 0,
    photos_failed: 0,
    failed_at: 2,
  });
  await page.getByRole('button', { name: 'Restore 3 recipes' }).click();
  await expect(page.getByRole('heading', { name: 'Restore stopped' })).toBeFocused();
  await expect(page.getByText('1 recipe restored before the problem')).toBeVisible();
  await expect(page.getByText('Stopped at recipe 2 of 3.', { exact: false })).toBeVisible();
  await audit(page);
});

test.describe('restore errors (spec 5.4)', () => {
  const alertText = async (text: string | RegExp) => {
    await expect(restoreAlert(page)).toContainText(text);
    await audit(page);
  };

  test('not a .json or .zip file (no request)', async () => {
    await page
      .locator(PICK)
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    await alertText('Choose a .json or .zip file exported by Cellar.');
  });
  test('a backup from a newer Cellar (R7)', async () => {
    await chooseAndCheck(page, jsonFile('v2.json', { ...freshDoc('x'), version: 2 }));
    await alertText('This backup was made by a newer Cellar. Upgrade this instance first.');
    await expect(restoreAlert(page)).toContainText('(backup version 2)');
  });
  test('not a backup', async () => {
    await chooseAndCheck(page, jsonFile('x.json', { hello: 'world' }));
    await alertText(/not a valid Cellar backup/);
  });
  test('a zip that cannot be read (traversal entry)', async () => {
    const zip = rawZip([
      { name: 'backup.json', data: Buffer.from(JSON.stringify(freshDoc('x'))) },
      { name: '../evil.webp', data: Buffer.from('x') },
    ]);
    await chooseAndCheck(page, { name: 'evil.zip', mimeType: 'application/zip', buffer: zip });
    await alertText(/zip file is not a valid Cellar backup archive/);
  });
  test('a member uploads an all-users file (only an admin can restore it)', async () => {
    const doc = allDoc(
      [{ email: member.email, name: member.name }],
      [docRecipe('x', { owner_email: member.email })],
    );
    await chooseAndCheck(page, jsonFile('all.json', doc));
    await alertText("Only an admin can restore a backup of every user's recipes.");
  });
  test('too large (413), restore already running (409), session expired (401), no connection', async () => {
    const file = jsonFile('x.json', freshDoc('x'));
    const stageUrl = /\/api\/import\/backup$/;
    await mockOnce(page, stageUrl, 'POST', 413, {
      error: 'backup_too_large',
      message:
        'This backup is too large to upload. Restore it without photos, or ask the instance owner to raise the upload limit.',
    });
    await chooseAndCheck(page, file);
    await alertText(/too large to upload/);

    await page.locator(PICK).setInputFiles(file);
    await mockOnce(page, stageUrl, 'POST', 409, { error: 'restore_in_progress', message: '' });
    await page.getByRole('button', { name: 'Check the file' }).click();
    await alertText('Another restore is running on this Cellar. Try again in a moment.');

    await page.locator(PICK).setInputFiles(file);
    await mockOnce(page, stageUrl, 'POST', 401, {});
    await page.getByRole('button', { name: 'Check the file' }).click();
    await alertText('Your session has expired. Sign in again.');

    await page.locator(PICK).setInputFiles(file);
    await page.route(stageUrl, (r) => r.abort('connectionfailed'), { times: 1 });
    await page.getByRole('button', { name: 'Check the file' }).click();
    await alertText('Could not reach the server. Check your connection and try again.');
  });
  test('the staged file expired before Restore (404), and a network error while restoring', async () => {
    await stage(page, jsonFile('f.json', freshDoc(`${PREFIX} Expired`)));
    await mockOnce(page, /\/apply$/, 'POST', 404, { error: 'not_found', message: '' });
    await page.getByRole('button', { name: 'Restore 2 recipes' }).click();
    await alertText('The checked file has expired. Choose it again.');
    await expect(page.getByRole('button', { name: 'Check the file' })).toBeVisible(); // back to step 1

    await stage(page, jsonFile('f.json', freshDoc(`${PREFIX} Offline`)));
    await page.route(/\/apply$/, (r) => r.abort('connectionfailed'), { times: 1 });
    await page.getByRole('button', { name: 'Restore 2 recipes' }).click();
    await alertText('Could not reach the server. Check your connection and try again.');
    // The preview stays so the owner can retry.
    await expect(page.getByRole('button', { name: 'Restore 2 recipes' })).toBeEnabled();
  });
});

test('keyboard only (spec 5.5): export checkboxes, file picker, Check, preview, strategy, Cancel, Restore, result', async () => {
  const press = (k: string) => page.keyboard.press(k);
  /** Tab until `target` has focus (bounded), so a stray extra stop in the shell fails loudly. */
  const tabTo = async (target: ReturnType<Page['locator']>) => {
    for (let i = 0; i < 40; i++) {
      await press('Tab');
      if (await target.evaluate((el) => el === document.activeElement)) return;
    }
    throw new Error('target never received focus by Tab');
  };

  const photos = page.getByRole('checkbox', { name: /Include photos/ });
  await tabTo(photos);
  await press('Space');
  await expect(photos).toBeChecked();
  const download = page.getByRole('link', { name: 'Download backup' });
  await tabTo(download); // a member has no second checkbox: the next stop is the link
  await expect(download).toHaveAttribute('href', '/api/export?photos=1');

  const picker = page.locator(PICK);
  await tabTo(picker);
  // The visually hidden input still shows a focus ring on its label.
  await expect(picker.locator('xpath=ancestor::label')).toHaveCSS('outline-style', 'solid');
  const chooser = page.waitForEvent('filechooser');
  await press('Enter');
  await (
    await chooser
  ).setFiles({
    name: 'kb.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(freshDoc(`${PREFIX} Keyboard`))),
  });
  const check = page.getByRole('button', { name: 'Check the file' });
  await press('Tab');
  await expect(check).toBeFocused();
  await press('Enter');
  await expect(page.getByText('Backup contents', { exact: true })).toBeFocused();

  // Strategy radios by arrows, then the confirm button, then Cancel.
  await press('Tab');
  const skip = page.getByRole('radio', { name: 'Skip them and keep mine' });
  await expect(skip).toBeFocused();
  await press('ArrowDown');
  await expect(page.getByRole('radio', { name: /Restore them as copies/ })).toBeChecked();
  await press('ArrowUp');
  await expect(skip).toBeChecked();
  await press('Tab');
  await expect(page.getByRole('button', { name: 'Restore 2 recipes' })).toBeFocused();
  await press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await press('Enter');
  await expect(picker).toBeFocused(); // back at step 1, focus on the picker

  // Again, this time to the end.
  const again = page.waitForEvent('filechooser');
  await press('Enter');
  await (
    await again
  ).setFiles({
    name: 'kb.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(freshDoc(`${PREFIX} Keyboard`))),
  });
  await press('Tab');
  await press('Enter');
  await expect(page.getByText('Backup contents', { exact: true })).toBeFocused();
  await press('Tab');
  await press('Tab');
  await expect(page.getByRole('button', { name: 'Restore 2 recipes' })).toBeFocused();
  await press('Enter');
  await expect(page.getByRole('heading', { name: 'Restore finished' })).toBeFocused();
  await press('Tab');
  await expect(page.getByRole('link', { name: 'Open my recipes' })).toBeFocused();
  await press('Tab');
  await expect(page.getByRole('button', { name: 'Restore another file' })).toBeFocused();
  await press('Enter');
  await expect(picker).toBeFocused();
});
