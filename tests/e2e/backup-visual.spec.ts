import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { account, ADMIN, createRecipe, registerViaInvite, SAMPLES, signIn } from './helpers';
import {
  allDoc,
  backupReady,
  deleteOwned,
  docRecipe,
  freshDoc,
  jsonFile,
  ownDoc,
  photoZip,
  stage,
} from './backup-support';
import { freezeDates } from './share-support';

/**
 * T12: visual baselines of /backup in its main states at 375 and 1280, light and dark. Baselines
 * are generated ONLY in the pinned Playwright image (scripts/update-visual-baselines.sh) and every
 * PNG is reviewed by eye (docs/tasks/v0.5.1-visual-report.md). Dates are frozen as in
 * media-visual.spec.ts (d78ed67); the page shows none, so the call is a guard.
 */
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const member = account('bkvis');
const PREFIX = 'BkVis';
let memberCtx: BrowserContext;
let adminCtx: BrowserContext;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, member);
  memberCtx = await browser.newContext();
  await signIn(await memberCtx.newPage(), member);
  adminCtx = await browser.newContext();
  await signIn(await adminCtx.newPage(), ADMIN);
  for (let i = 1; i <= 7; i++) {
    await createRecipe(memberCtx, { ...SAMPLES.cookie, title: `${PREFIX} Existing ${i}` });
  }
});
test.afterAll(async () => {
  await deleteOwned(memberCtx, member.name, PREFIX);
  await deleteOwned(adminCtx, ADMIN.name, PREFIX);
  await memberCtx?.close();
  await adminCtx?.close();
});

type View = { w: number; h: number };
const PHONE: View = { w: 375, h: 812 };
const DESKTOP: View = { w: 1280, h: 800 };

async function open(browser: Browser, as: BrowserContext, v: View, scheme: 'light' | 'dark') {
  const ctx = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: scheme,
    reducedMotion: 'reduce',
    storageState: await as.storageState(),
  });
  const page = await ctx.newPage();
  await backupReady(page);
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => ctx.close() };
}

async function shot(page: Page, name: string) {
  await freezeDates(page).catch(() => undefined);
  await expect(page.getByRole('main')).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
  });
}

const conflictDoc = () =>
  ownDoc([
    ...Array.from({ length: 7 }, (_, i) => docRecipe(`${PREFIX} Existing ${i + 1}`)),
    docRecipe(`${PREFIX} Brand new`, { tags: ['dessert'] }),
  ]);

for (const v of [PHONE, DESKTOP]) {
  for (const scheme of ['light', 'dark'] as const) {
    const tag = `${scheme}-${v.w}`;

    test(`initial, member (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, memberCtx, v, scheme);
      await shot(page, `initial-member-${tag}.png`);
      await close();
    });

    test(`initial, admin with both export options on (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, adminCtx, v, scheme);
      await page.getByRole('checkbox', { name: /Include photos/ }).check();
      await page.getByRole('checkbox', { name: /Include all users/ }).check();
      await shot(page, `initial-admin-${tag}.png`);
      await close();
    });

    test(`file chosen (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, memberCtx, v, scheme);
      await page
        .locator('input[type="file"]')
        .setInputFiles(jsonFile('cellar-backup-2026-11-15.json', freshDoc(`${PREFIX} Chosen`)));
      await expect(page.getByText('cellar-backup-2026-11-15.json,')).toBeVisible();
      await shot(page, `file-chosen-${tag}.png`);
      await close();
    });

    test(`preview with conflicts, long list open (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, memberCtx, v, scheme);
      await stage(page, jsonFile('f.json', conflictDoc()));
      await page.getByText('Show all 7').click();
      await shot(page, `preview-conflicts-${tag}.png`);
      await close();
    });

    test(`preview, nothing new (Restore disabled with its reason) (${tag})`, async ({
      browser,
    }) => {
      const { page, close } = await open(browser, memberCtx, v, scheme);
      await stage(
        page,
        jsonFile(
          'f.json',
          ownDoc([docRecipe(`${PREFIX} Existing 1`), docRecipe(`${PREFIX} Existing 2`)]),
        ),
      );
      await shot(page, `preview-none-${tag}.png`);
      await close();
    });

    test(`preview, admin file with owners not found (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, adminCtx, v, scheme);
      const doc = allDoc(
        [{ email: 'marie@example.test', name: 'Marie' }],
        [
          docRecipe(`${PREFIX} Marie 1`, { owner_email: 'marie@example.test' }),
          docRecipe(`${PREFIX} Marie 2`, { owner_email: 'marie@example.test' }),
        ],
      );
      await stage(page, jsonFile('all.json', doc));
      await shot(page, `preview-admin-${tag}.png`);
      await close();
    });

    test(`error: backup from a newer Cellar (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, memberCtx, v, scheme);
      await page
        .locator('input[type="file"]')
        .setInputFiles(jsonFile('v2.json', { ...freshDoc('x'), version: 2 }));
      await page.getByRole('button', { name: 'Check the file' }).click();
      await expect(page.getByRole('region', { name: 'Restore' }).getByRole('alert')).toContainText(
        'newer Cellar',
      );
      await shot(page, `error-version-${tag}.png`);
      await close();
    });

    test(`result with photos (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, memberCtx, v, scheme);
      const zip = await photoZip(`${PREFIX} Result ${tag}`);
      await stage(page, { name: 'photos.zip', mimeType: 'application/zip', buffer: zip });
      await page.getByRole('button', { name: 'Restore 2 recipes' }).click();
      await expect(page.getByRole('heading', { name: 'Restore finished' })).toBeFocused();
      await shot(page, `result-${tag}.png`);
      await close();
    });
  }
}
