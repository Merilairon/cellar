import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
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
  failOnce,
  importedCake,
  linkField,
  linkSwitch,
  listRecipe,
  openShare,
  recipeWithLink,
  SOURCE_NAME,
} from './share-support';

// T7: axe (WCAG 2.2 A/AA tags) on every state of the share dialog (UX spec sections 1, 2, 6),
// the public page, the print option and the recipe page's actions row, in light and dark at 375
// and 1280, plus the keyboard paths of the dialog (spec 1.6) and the public page (3.4). Axe finds
// a fraction of the issues; real screen-reader testing is NOT covered here (T16 / owner try).
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const owner = account('sharea11y');
const reader = account('readera11y');
let ownerCtx: BrowserContext;
let readerCtx: BrowserContext;
const ids = { plain: '', imported: '', list: '', noted: '' };
const links = { cake: '', list: '' };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, owner);
  await registerViaInvite(browser, reader);
  ownerCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await signIn(await ownerCtx.newPage(), owner);
  readerCtx = await browser.newContext();
  await signIn(await readerCtx.newPage(), reader);
  ids.imported = await createRecipe(ownerCtx, importedCake('A11y Imported Cake'));
  ids.noted = await createRecipe(ownerCtx, {
    ...SAMPLES.cookie,
    title: 'A11y Noted Cookie',
    visibility: 'users',
  });
  const note = await ownerCtx.request.post(`/api/recipes/${ids.noted}/notes`, {
    headers: ORIGIN,
    data: { body: 'Use less sugar next time.', shared: false },
  });
  expect(note.status()).toBe(201);
  const cake = await recipeWithLink(ownerCtx, importedCake('A11y Public Cake'));
  links.cake = cake.url;
  const list = await recipeWithLink(ownerCtx, listRecipe('A11y Public List'));
  ids.list = list.id;
  links.list = list.url;
});
test.afterAll(async () => {
  await ownerCtx?.close();
  await readerCtx?.close();
});

type View = { w: number; h: number; scheme: 'light' | 'dark' };
const VIEWS: View[] = [
  { w: 375, h: 812, scheme: 'light' },
  { w: 375, h: 812, scheme: 'dark' },
  { w: 1280, h: 900, scheme: 'light' },
  { w: 1280, h: 900, scheme: 'dark' },
];

async function open(browser: Browser, path: string, v: View, as?: BrowserContext) {
  const c = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    colorScheme: v.scheme,
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
    ...(as ? { storageState: await as.storageState() } : {}),
  });
  const page = await c.newPage();
  await page.goto(path);
  return { page, close: () => c.close() };
}

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map((x) => ({
      state: label,
      id: x.id,
      impact: x.impact,
      nodes: x.nodes.map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over, `${label}: page overflow`).toBeLessThanOrEqual(0);
}

const sw = (d: Locator) => linkSwitch(d);

for (const v of VIEWS) {
  const tag = `${v.scheme} ${v.w}`;

  test(`axe: share dialog, every state (${tag})`, async ({ browser }) => {
    test.setTimeout(120_000);
    // A fresh recipe per view: the walk below changes its sharing.
    const id = await createRecipe(ownerCtx, { ...SAMPLES.cookie, title: `Dialog walk ${tag}` });
    const { page, close } = await open(browser, `/recipes/${id}`, v, ownerCtx);
    const dialog = await openShare(page);
    const check = async (label: string) => {
      await axe(page, `${label} (${tag})`);
      await noOverflow(page, label);
    };

    // Section 1.
    await check('default: private, link off');
    await dialog.getByRole('radio', { name: 'All users (read-only)' }).check();
    await expect(dialog.getByRole('status')).toHaveText(/^All users of this Cellar can read/);
    await check('users, link off');
    await failOnce(page, /\/visibility$/, 'PUT', 500);
    await dialog.getByRole('radio', { name: 'Private' }).check();
    await expect(dialog.getByRole('alert')).toHaveText('Could not save. Try again.');
    await expect(dialog.getByRole('radio', { name: 'All users (read-only)' })).toBeChecked();
    await check('visibility error (500)');
    await failOnce(page, /\/visibility$/, 'PUT', 403);
    await dialog.getByRole('radio', { name: 'Private' }).check();
    await expect(dialog.getByRole('alert')).toHaveText(
      'You can no longer change sharing for this recipe.',
    );
    await check('visibility error (403)');
    await dialog.getByRole('radio', { name: 'Private' }).check(); // real save, clears the alert
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // Section 2: turning on, pending, failing, succeeding.
    await failOnce(page, /\/share-link$/, 'POST', 500);
    await sw(dialog).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Could not turn on the public link. Try again.',
    );
    await check('turn on failed');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(/\/share-link$/, async (route) => {
      await gate;
      await route.continue();
    });
    await sw(dialog).click();
    await expect(sw(dialog)).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByText('Turning on…')).toBeVisible();
    await check('turning on (pending)');
    release();
    await expect(sw(dialog)).toBeChecked();
    await page.unroute(/\/share-link$/);
    await check('link on: field, Copy link, New link');

    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Link copied.');
    await check('copied');

    // Rotate: confirm, failure, success.
    await dialog.getByRole('button', { name: 'New link' }).click();
    await expect(dialog.getByRole('group', { name: /Make a new link/ })).toBeVisible();
    await check('rotate confirm');
    await failOnce(page, /\/share-link$/, 'POST', 500);
    await dialog.getByRole('button', { name: 'Make new link' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Could not make a new link. The old link still works.',
    );
    await expect(dialog.getByRole('button', { name: 'New link' })).toBeFocused();
    await check('rotate failed');
    await dialog.getByRole('button', { name: 'New link' }).click();
    await dialog.getByRole('button', { name: 'Make new link' }).click();
    await expect(dialog.getByRole('status')).toHaveText(
      'New link ready. The old link no longer works.',
    );
    await check('rotated');

    // Turn off: confirm, failure, success.
    await sw(dialog).click();
    await expect(dialog.getByRole('group', { name: /Turn off the public link/ })).toBeVisible();
    await check('turn off confirm');
    await failOnce(page, /\/share-link$/, 'DELETE', 500);
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Could not turn off the link. It still works. Try again.',
    );
    await expect(sw(dialog)).toBeFocused();
    await check('turn off failed');
    await failOnce(page, /\/share-link$/, 'DELETE', 404);
    await sw(dialog).click();
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'You can no longer change sharing for this recipe.',
    );
    await check('link error (404)');
    await sw(dialog).click();
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(sw(dialog)).not.toBeChecked();
    await expect(linkField(dialog)).toHaveCount(0);
    await check('turned off again');

    // Server says links are disabled (env off): the switch is replaced by one line.
    await failOnce(page, /\/share-link$/, 'POST', 403, { error: 'public_links_disabled' });
    await sw(dialog).click();
    await expect(
      dialog.getByText('Public links are turned off on this Cellar by its admin.'),
    ).toBeVisible();
    await expect(dialog.getByRole('switch')).toHaveCount(0);
    await check('public links disabled (one line, no switch)');
    await close();
  });

  test(`axe: share dialog with the copyright notice (${tag})`, async ({ browser }) => {
    const { page, close } = await open(browser, `/recipes/${ids.imported}`, v, ownerCtx);
    const dialog = await openShare(page);
    await expect(dialog.getByRole('note', { name: /imported and not edited/ })).toContainText(
      SOURCE_NAME,
    );
    await axe(page, `notice (${tag})`);
    await dialog.getByRole('radio', { name: 'All users (read-only)' }).check();
    await sw(dialog).click();
    await expect(sw(dialog)).toBeChecked();
    await axe(page, `notice with link on (${tag})`);
    await noOverflow(page, 'notice');
    await close();
  });

  test(`axe: public page, grid, list, scaled, step open, 404 (${tag})`, async ({ browser }) => {
    const { page, close } = await open(browser, links.cake, v);
    await hydrated(page.getByRole('button', { name: '2x', exact: true }));
    await expect(page.getByRole('heading', { level: 1, name: 'A11y Public Cake' })).toBeVisible();
    await axe(page, `public default (${tag})`);
    await noOverflow(page, 'public default');

    await page.getByRole('button', { name: '2x', exact: true }).click();
    await page.getByRole('button', { name: 'Show in US units' }).click();
    await expect(page.getByText(/Units: US\./)).toBeVisible();
    await axe(page, `public scaled 2x, US units (${tag})`);

    // A step: inline detail on desktop, bottom sheet on a phone.
    const step = page.locator('[data-step-id]').first();
    await step.focus();
    await page.keyboard.press('Enter');
    if (v.w < 640) await expect(page.getByRole('dialog')).toBeVisible();
    else await expect(step).toHaveAttribute('aria-expanded', 'true');
    await axe(page, `public step open (${tag})`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (v.w < 640) await expect(step).toBeFocused();

    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.locator('table.rg-table')).toHaveCount(0);
    await axe(page, `public list (${tag})`);
    await noOverflow(page, 'public list');

    await page.goto(links.list);
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toBeDisabled();
    await expect(page.getByText(/no grid layout yet/)).toBeVisible();
    await axe(page, `public list-only recipe, Grid disabled (${tag})`);

    const missing = await page.goto('/r/AAAAAAAAAAAAAAAAAAAAAA');
    expect(missing?.status()).toBe(404);
    await expect(page.getByText('This link is invalid or has expired.')).toBeVisible();
    await axe(page, `uniform 404 (${tag})`);
    await close();
  });

  test(`axe: recipe page actions row and the print option (${tag})`, async ({ browser }) => {
    // Owner: Share, state chip, Print; notes checkbox off and on.
    const o = await open(browser, `/recipes/${ids.noted}`, v, ownerCtx);
    await hydrated(o.page.getByRole('button', { name: 'Share', exact: true }));
    const box = o.page.getByLabel('Include notes when printing');
    await expect(box).not.toBeChecked();
    await axe(o.page, `owner page, print option off (${tag})`);
    await box.check();
    await axe(o.page, `owner page, print option on (${tag})`);
    await noOverflow(o.page, 'owner page');
    await o.close();
    // Reader: Cook, Save a copy, Print (no Share).
    const r = await open(browser, `/recipes/${ids.noted}`, v, readerCtx);
    await expect(r.page.getByRole('button', { name: 'Print' })).toBeVisible();
    await axe(r.page, `reader page (${tag})`);
    await r.close();
  });
}

test('print option: labelled checkbox and the Print button with its landscape hint', async ({
  browser,
}) => {
  const { page, close } = await open(
    browser,
    `/recipes/${ids.noted}`,
    { w: 1280, h: 900, scheme: 'light' },
    ownerCtx,
  );
  const box = page.getByRole('checkbox', { name: 'Include notes when printing' });
  await expect(box).toBeVisible();
  const print = page.getByRole('button', { name: 'Print' });
  await expect(print).toHaveAccessibleDescription('Landscape fits the grid on one page.');
  await close();
  // On a phone the hint is not shown but stays the button's description.
  const phone = await open(
    browser,
    `/recipes/${ids.noted}`,
    { w: 375, h: 812, scheme: 'light' },
    ownerCtx,
  );
  const pb = phone.page.getByRole('button', { name: 'Print' });
  await expect(pb).toHaveAccessibleDescription('Landscape fits the grid on one page.');
  await phone.close();
});

test('clipboard unavailable: the field is selected and the status says how to copy', async ({
  browser,
}) => {
  for (const touch of [false, true]) {
    const id = await createRecipe(ownerCtx, { ...SAMPLES.cookie, title: `No clipboard ${touch}` });
    const c = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: touch,
      isMobile: touch,
      storageState: await ownerCtx.storageState(),
    });
    await c.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    const page = await c.newPage();
    await page.goto(`/recipes/${id}`);
    const dialog = await openShare(page);
    await sw(dialog).click();
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('status')).toHaveText(
      touch ? 'Select the link and copy it.' : 'Select the link and copy it with Ctrl+C.',
    );
    await expect(linkField(dialog)).toBeFocused();
    // The whole value is selected, so Ctrl+C copies the link.
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      await linkField(dialog).inputValue(),
    );
    await axe(page, `copy manual (touch=${touch})`);
    await c.close();
  }
});

test('keyboard path through the dialog (UX spec 1.6): open, radios, switch, confirm, Escape', async ({
  browser,
}) => {
  const id = await createRecipe(ownerCtx, { ...SAMPLES.cookie, title: 'Keyboard walk' });
  const { page, close } = await open(
    browser,
    `/recipes/${id}`,
    { w: 1280, h: 900, scheme: 'light' },
    ownerCtx,
  );
  const share = page.getByRole('button', { name: 'Share', exact: true });
  await hydrated(share);
  await share.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Share recipe' });
  await expect(dialog.getByRole('heading', { name: 'Share recipe' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('radio', { name: 'Private' })).toBeFocused();
  await page.keyboard.press('ArrowDown'); // arrows move and select, which saves
  await expect(dialog.getByRole('radio', { name: 'All users (read-only)' })).toBeChecked();
  await expect(dialog.getByRole('status')).toHaveText(/^All users of this Cellar can read/);
  await page.keyboard.press('Tab');
  await expect(sw(dialog)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sw(dialog)).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(linkField(dialog)).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'New link' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
  // The safe choice has focus first although it follows the action in reading order.
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Make new link' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Enter'); // Keep
  await expect(dialog.getByRole('button', { name: 'New link' })).toBeFocused();

  // Off direction: confirm with Keep focused; Escape drops it and closes the dialog.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
  await expect(sw(dialog)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(share).toBeFocused();

  // Reopened: the confirm is gone, the link is still on, and focus stays trapped inside.
  await share.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('group', { name: /Turn off/ })).toHaveCount(0);
  await expect(sw(dialog)).toBeChecked();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    // A native modal lets focus pass through the browser UI (body) but never reach the page behind.
    expect(
      await page.evaluate(() => {
        const el = document.activeElement;
        return el === document.body || !!el?.closest('dialog');
      }),
    ).toBe(true);
  }
  await close();
});

test('keyboard path on the public page (UX spec 3.4)', async ({ browser }) => {
  const { page, close } = await open(browser, links.cake, {
    w: 1280,
    h: 900,
    scheme: 'light',
  });
  await hydrated(page.getByRole('button', { name: '2x', exact: true }));
  const seen: string[] = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return (el?.getAttribute('aria-label') || el?.innerText || el?.tagName || '').trim();
      }),
    );
  }
  const order = ['Example Kitchen', '2x', 'Grid', 'List', 'Print'];
  let at = -1;
  for (const want of order) {
    const next = seen.findIndex((s, i) => i > at && s.includes(want));
    expect(next, `${want} in ${JSON.stringify(seen)}`).toBeGreaterThan(at);
    at = next;
  }
  await close();
});

test('axe: host-only notice and banner, chip variants, no notes checkbox without notes, Share hidden in the grid editor', async ({
  browser,
}) => {
  const v: View = { w: 375, h: 812, scheme: 'light' };
  const hostOnly = await recipeWithLink(ownerCtx, {
    ...importedCake('Host Only'),
    source_name: '',
  });
  const a = await open(browser, `/recipes/${hostOnly.id}`, v, ownerCtx);
  const dialog = await openShare(a.page);
  await expect(dialog.getByRole('note')).toContainText('It came from www.example-kitchen.test.');
  await axe(a.page, 'notice, host only');
  await dialog.getByRole('radio', { name: 'All users (read-only)' }).check();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(a.page.getByText('All users · Public link')).toBeVisible();
  await expect(a.page.getByLabel('Include notes when printing')).toHaveCount(0); // no notes yet
  await axe(a.page, 'chip: all users + link');
  await a.close();

  const b = await open(browser, hostOnly.url, v);
  await expect(
    b.page.getByRole('link', { name: 'Source: www.example-kitchen.test' }),
  ).toBeVisible();
  await axe(b.page, 'public banner, host only');
  await b.close();

  const plain = await createRecipe(ownerCtx, { ...SAMPLES.cake, title: 'Chip Link Only' });
  await ownerCtx.request.post(`/api/recipes/${plain}/share-link`, { headers: ORIGIN });
  const c = await open(browser, `/recipes/${plain}`, v, ownerCtx);
  await expect(c.page.getByText('Public link', { exact: true })).toBeVisible();
  await axe(c.page, 'chip: link only');
  await c.page.getByRole('button', { name: 'Edit grid layout' }).click();
  await expect(c.page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await c.close();
});
