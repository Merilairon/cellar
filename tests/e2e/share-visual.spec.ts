import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';
import {
  freezeDates,
  importedCake,
  linkField,
  linkSwitch,
  makeLink,
  openShare,
  pageOverflow,
  recipeWithLink,
} from './share-support';

/**
 * T7: visual baselines for the slice A surfaces: the share dialog in its main states at 375 and
 * 1280 (light and dark), the public page at 375, 768 and 1280 (light and dark), and the recipe
 * page's actions row (Share, state chip, Print). Baselines are generated ONLY in the pinned
 * Playwright image (scripts/update-visual-baselines.sh) and every PNG is reviewed by eye
 * (docs/tasks/v0.5.0-visual-report.md). The public link's random token is masked; dates are
 * frozen as in media-visual.spec.ts (d78ed67).
 */
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const owner = account('sharevis');
const reader = account('readervis');
let ownerCtx: BrowserContext;
let readerCtx: BrowserContext;
const ids = { actions: '', imported: '' };
let publicUrl = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, owner);
  await registerViaInvite(browser, reader);
  ownerCtx = await browser.newContext();
  await signIn(await ownerCtx.newPage(), owner);
  readerCtx = await browser.newContext();
  await signIn(await readerCtx.newPage(), reader);
  // Stable recipes for the page-level shots; the dialog shots create their own per test.
  ids.actions = await createRecipe(ownerCtx, {
    ...SAMPLES.cake,
    title: 'Visual Actions Cake',
    visibility: 'users',
  });
  await makeLink(ownerCtx, ids.actions);
  ids.imported = await createRecipe(ownerCtx, importedCake('Visual Imported Cake'));
  publicUrl = (
    await recipeWithLink(ownerCtx, {
      ...importedCake('Visual Public Cake'),
      description: 'A simple one-layer vanilla cake with a quick buttercream.',
    })
  ).url;
});
test.afterAll(async () => {
  await ownerCtx?.close();
  await readerCtx?.close();
});

type View = { w: number; h: number };
const PHONE: View = { w: 375, h: 812 };
const DESKTOP: View = { w: 1280, h: 800 };
const SCHEMES = ['light', 'dark'] as const;

async function open(
  browser: Browser,
  path: string,
  v: View,
  scheme: 'light' | 'dark',
  as?: BrowserContext,
) {
  const ctx = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: scheme,
    reducedMotion: 'reduce',
    ...(as ? { storageState: await as.storageState() } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => ctx.close() };
}

async function shot(page: Page, name: string, target: Locator, mask: Locator[] = []) {
  await freezeDates(page);
  await expect(target).toHaveScreenshot(name, { animations: 'disabled', caret: 'hide', mask });
}

for (const v of [PHONE, DESKTOP]) {
  for (const scheme of SCHEMES) {
    const tag = `${scheme}-${v.w}`;

    test(`share dialog: private, link off (${tag})`, async ({ browser }) => {
      const id = await createRecipe(ownerCtx, { ...SAMPLES.cake, title: 'Visual Dialog Cake' });
      const { page, close } = await open(browser, `/recipes/${id}`, v, scheme, ownerCtx);
      const dialog = await openShare(page);
      await expect(dialog.getByRole('status')).toHaveText('Only you can see this recipe.');
      await shot(page, `dialog-private-${tag}.png`, dialog);
      await close();
    });

    test(`share dialog: all users, link on with the URL field (${tag})`, async ({ browser }) => {
      const id = await createRecipe(ownerCtx, {
        ...SAMPLES.cake,
        title: 'Visual Dialog Cake',
        visibility: 'users',
      });
      await makeLink(ownerCtx, id);
      const { page, close } = await open(browser, `/recipes/${id}`, v, scheme, ownerCtx);
      const dialog = await openShare(page);
      await expect(linkSwitch(dialog)).toBeChecked();
      // The token is random per run: the field's box is masked, its look is still in the shot.
      await shot(page, `dialog-link-on-${tag}.png`, dialog, [linkField(dialog)]);
      await close();
    });

    test(`share dialog: copyright notice on an imported recipe (${tag})`, async ({ browser }) => {
      const { page, close } = await open(browser, `/recipes/${ids.imported}`, v, scheme, ownerCtx);
      const dialog = await openShare(page);
      await expect(dialog.getByRole('note')).toBeVisible();
      await shot(page, `dialog-notice-${tag}.png`, dialog);
      await close();
    });

    test(`share dialog: turn-off confirm (${tag})`, async ({ browser }) => {
      const id = await createRecipe(ownerCtx, { ...SAMPLES.cake, title: 'Visual Dialog Cake' });
      await makeLink(ownerCtx, id);
      const { page, close } = await open(browser, `/recipes/${id}`, v, scheme, ownerCtx);
      const dialog = await openShare(page);
      await linkSwitch(dialog).click();
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
      await shot(page, `dialog-confirm-off-${tag}.png`, dialog, [linkField(dialog)]);
      await close();
    });

    test(`recipe page actions row: owner with Share, chip and Print (${tag})`, async ({
      browser,
    }) => {
      const { page, close } = await open(browser, `/recipes/${ids.actions}`, v, scheme, ownerCtx);
      await hydrated(page.getByRole('button', { name: 'Share', exact: true }));
      await expect(page.getByText('All users · Public link')).toBeVisible();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      const row = page.getByRole('button', { name: 'Cook', exact: true }).locator('..');
      await shot(page, `actions-owner-${tag}.png`, row);
      await close();
    });
  }
}

for (const v of [PHONE, DESKTOP]) {
  test(`recipe page actions row: reader with Save a copy and Print (light-${v.w})`, async ({
    browser,
  }) => {
    const { page, close } = await open(browser, `/recipes/${ids.actions}`, v, 'light', readerCtx);
    await expect(page.getByRole('button', { name: 'Save a copy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
    const row = page.getByRole('button', { name: 'Cook', exact: true }).locator('..');
    await shot(page, `actions-reader-light-${v.w}.png`, row);
    await close();
  });
}

for (const w of [375, 768, 1280]) {
  for (const scheme of SCHEMES) {
    test(`public page (${scheme}) @${w}`, async ({ browser }) => {
      const { page, close } = await open(browser, publicUrl, { w, h: 900 }, scheme);
      await hydrated(page.getByRole('button', { name: '2x', exact: true }));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `public-${scheme}-${w}.png`, page.locator('main'));
      await close();
    });
  }
}
