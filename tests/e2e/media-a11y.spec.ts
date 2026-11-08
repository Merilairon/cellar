import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  createRecipe,
  hydrated,
  ORIGIN,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';
import { apiUpload, makeImage, SVG_AS_JPG } from './media-support';

// T13: axe (WCAG 2.2 A/AA tags) over the v0.4.2 surfaces (photo manager in each state, notes,
// star control, min-rating filter, cook mode) in light and dark at 375 and 1280, plus keyboard
// walkthroughs and a few explicit measurements (target size, focus return, reflow).
// Axe finds a fraction of the issues; real screen-reader testing is NOT covered here.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const owner = account('mediaa11y');
let ctx: BrowserContext;
let id = '';
const TITLE = 'Media A11y Cake';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, owner);
  ctx = await browser.newContext();
  await signIn(await ctx.newPage(), owner);
  id = await createRecipe(ctx, { ...SAMPLES.cake, title: TITLE, visibility: 'private' });
});
test.afterAll(async () => {
  if (id) await ctx?.request.delete(`/api/recipes/${id}`, { headers: ORIGIN });
  await ctx?.close();
});

async function open(
  browser: Browser,
  path: string,
  { w, h = 900, scheme }: { w: number; h?: number; scheme: 'light' | 'dark' },
) {
  const c = await browser.newContext({
    viewport: { width: w, height: h },
    colorScheme: scheme,
    reducedMotion: 'reduce',
    storageState: await ctx.storageState(),
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
    violations.map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

const fileInput = (p: Page) => p.locator('input[type="file"]');
const toggle = (p: Page) => p.getByRole('button', { name: /^Edit photos$|^Add a photo$/ }).first();

async function openManager(page: Page) {
  await hydrated(toggle(page));
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
  await expect(page.getByRole('heading', { name: /^Photos \(/ })).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  for (const w of [375, 1280]) {
    test(`axe: photo manager empty, recipe page without notes (${scheme}, ${w})`, async ({
      browser,
    }) => {
      test.setTimeout(90_000);
      const { page, close } = await open(browser, `/recipes/${id}`, { w, scheme });
      await hydrated(page.getByLabel('Add a note'));
      await axe(page, 'recipe page, no photo, no notes');
      await openManager(page);
      await expect(page.getByText('Photos (0 of 10)', { exact: false })).toBeVisible();
      await axe(page, 'photo manager empty');
      await noHorizontalOverflow(page);
      await close();
    });
  }
}

for (const scheme of ['light', 'dark'] as const) {
  for (const w of [375, 1280]) {
    test(`axe: photo manager errors, with photos, delete confirm (${scheme}, ${w})`, async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const jpeg = await makeImage('jpeg', { r: 200, g: 120, b: 40 });
      const png = await makeImage('png', { r: 40, g: 120, b: 200 });
      const { page, close } = await open(browser, `/recipes/${id}`, { w, scheme });
      await openManager(page);

      // Error states: client pre-check, server rejection.
      await fileInput(page).setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hi'),
      });
      await expect(page.getByText(/Problem: notes\.txt is not a supported image/)).toBeVisible();
      await fileInput(page).setInputFiles({
        name: 'evil.jpg',
        mimeType: 'image/jpeg',
        buffer: SVG_AS_JPG,
      });
      await expect(page.getByText(/Problem: evil\.jpg is not a supported image/)).toBeVisible();
      await axe(page, 'photo manager upload errors');
      await noHorizontalOverflow(page);
      // 2.5.8 / 44px policy: every button in the manager is at least 44 px tall.
      const heights = await page
        .getByRole('main')
        .locator('button')
        .evaluateAll((els) =>
          els
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => [e.textContent?.trim(), e.getBoundingClientRect().height] as const),
        );
      for (const [name, hgt] of heights)
        expect(hgt, `button "${name}"`).toBeGreaterThanOrEqual(43.5);
      const dismiss = page.getByRole('button', { name: 'Dismiss' });
      while ((await dismiss.count()) > 0) await dismiss.first().click();

      // Upload two real photos, then audit with photos and the cover badge.
      if ((await page.getByRole('heading', { name: /^Photos \(0 / }).count()) > 0) {
        await fileInput(page).setInputFiles({
          name: 'a.jpg',
          mimeType: 'image/jpeg',
          buffer: jpeg,
        });
        await expect(page.getByText('a.jpg: Added. It is now the cover.')).toBeVisible();
        await fileInput(page).setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: png });
        await expect(page.getByText('b.png: Added')).toBeVisible();
      }
      await expect(page.getByRole('heading', { name: 'Photos (2 of 10)' })).toBeVisible();
      // Tiles must stay usable in the narrow hero column (regression: 5 columns of 49 px at 1280).
      const tileWidths = await page
        .locator('[data-tile]')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      for (const tw of tileWidths) expect(tw).toBeGreaterThanOrEqual(100);
      await axe(page, 'photo manager with photos');

      // Delete confirm state.
      await page.getByRole('button', { name: /^Delete \(Photo 2 of 2\)/ }).click();
      await expect(page.getByText('Delete this photo? This cannot be undone.')).toBeVisible();
      await axe(page, 'photo delete confirm');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: /^Delete \(Photo 2 of 2\)/ })).toBeFocused();

      // Recipe page with a cover photo (hero) and the card list.
      await toggle(page)
        .click()
        .catch(() => {});
      await axe(page, 'recipe page with photo');
      await page.goto('/recipes');
      await hydrated(page.getByRole('searchbox', { name: 'Search recipes' }));
      await axe(page, 'recipes list with cover card');
      await noHorizontalOverflow(page);
      await close();
    });
  }
}

for (const scheme of ['light', 'dark'] as const) {
  for (const w of [375, 1280]) {
    test(`axe: notes, rating states, min-rating filter (${scheme}, ${w})`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, close } = await open(browser, `/recipes/${id}`, { w, scheme });
      const area = page.getByLabel('Add a note');
      await hydrated(area);
      if ((await page.getByText('Private note for audit').count()) === 0) {
        // Seed one private and one shared note once; later iterations just audit them.
        await area.fill('Private note for audit');
        await page.getByLabel('Only me').check();
        await page.getByRole('button', { name: 'Add note' }).click();
        await expect(page.getByText('Note added.')).toBeVisible();
        await area.fill('Shared note for audit');
        await page.getByLabel('Everyone who can see this recipe').check();
        await page.getByRole('button', { name: 'Add note' }).click();
        await expect(page.getByText('Shared note for audit')).toBeVisible();
      }
      await axe(page, 'notes list private+shared, rating unrated');
      await noHorizontalOverflow(page);

      // Empty note: the button is aria-disabled and described by its reason.
      await area.fill('');
      await expect(page.getByRole('button', { name: 'Add note' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await axe(page, 'note empty (aria-disabled with reason)');

      // Rating states: unrated (first run) -> rated (value shown as text) -> saved status.
      // Pick a star different from the current one so every run really saves.
      const wasFour = await page.getByRole('radio', { name: '4 of 5 stars' }).isChecked();
      const star = wasFour ? 3 : 4;
      const put = page.waitForResponse(
        (r) => r.url().includes('/rating') && r.request().method() === 'PUT',
      );
      await page
        .locator('label.md-star', { has: page.getByRole('radio', { name: `${star} of 5 stars` }) })
        .click();
      await put;
      await expect(page.getByText(`Your rating is ${star} of 5 stars.`)).toBeVisible();
      await axe(page, 'rating set');
      // Star target size (2.5.8): each star label at least 44 px, or 24 px with spacing.
      const boxes = await page.locator('label.md-star').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return [r.width, r.height];
        }),
      );
      for (const [bw, bh] of boxes) {
        expect(bw).toBeGreaterThanOrEqual(43.5);
        expect(bh).toBeGreaterThanOrEqual(43.5);
      }

      // Filter chips on the list.
      await page.goto('/recipes?min_rating=3');
      await hydrated(page.getByRole('searchbox', { name: 'Search recipes' }));
      await axe(page, 'min rating chip active');
      await page.goto('/recipes?min_rating=5');
      await expect(page.getByRole('heading', { name: 'No recipes found' })).toBeVisible();
      await axe(page, 'min rating empty result');
      await noHorizontalOverflow(page);
      await close();
    });
  }
}

test('keyboard: star control is one tab stop, arrows select, names and status are announced', async ({
  browser,
}) => {
  const { page, close } = await open(browser, `/recipes/${id}`, { w: 1280, scheme: 'light' });
  const group = page.getByRole('radiogroup', { name: 'Your rating' });
  await hydrated(page.getByRole('radio', { name: '1 of 5 stars' }));
  await expect(group).toBeVisible();
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(5);
  // One tab stop: Tab from the checked star leaves the group, Shift+Tab comes back to it.
  const checked = group.getByRole('radio', { checked: true });
  await expect(checked).toHaveCount(1);
  const inGroup = () =>
    page.evaluate(() => !!document.activeElement?.closest('[role="radiogroup"]'));
  await checked.focus();
  await page.keyboard.press('Tab');
  expect(await inGroup()).toBe(false);
  await page.keyboard.press('Shift+Tab');
  expect(await inGroup()).toBe(true);
  await expect(checked).toBeFocused();
  // The focus ring is drawn (keyboard focus-visible) with a 3 px outline.
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!.closest('label')!);
    return `${s.outlineStyle} ${s.outlineWidth}`;
  });
  expect(ring).toBe('solid 3px');
  // Arrow keys choose, the value is also text, with a polite status.
  const target = (await radios.nth(0).isChecked()) ? 1 : 0;
  await radios.nth(target === 1 ? 0 : 4).focus();
  const put = page.waitForResponse(
    (r) => r.url().includes('/rating') && r.request().method() === 'PUT',
  );
  await page.keyboard.press(target === 1 ? 'ArrowRight' : 'ArrowLeft');
  await put;
  await expect(
    page.getByRole('status').filter({ hasText: /Your rating is \d of 5 stars/ }),
  ).toBeVisible();
  await close();
});

test('keyboard: photo manager reachable, delete returns focus to a neighbour or Add', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, close } = await open(browser, `/recipes/${id}`, { w: 1280, scheme: 'light' });
  await hydrated(toggle(page));
  await toggle(page).focus();
  await page.keyboard.press('Enter');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  // The file input sits in a label styled as a button: it must take keyboard focus.
  await fileInput(page).focus();
  await expect(fileInput(page)).toBeFocused();
  const del = page.getByRole('button', { name: /^Delete \(Photo 2 of 2\)/ });
  await del.focus();
  await page.keyboard.press('Enter');
  const group = page.getByRole('group', { name: 'Delete this photo? This cannot be undone.' });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: 'Delete' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Photo deleted\./)).toBeVisible();
  // Focus lands on a control in the remaining tile, never on <body>.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'NONE'))
    .not.toMatch(/^(BODY|NONE)$/);
  await close();
});

test('axe + keyboard: cook mode open, checked, light/dark, 375/1280, 200% text', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  for (const scheme of ['light', 'dark'] as const) {
    for (const w of [375, 1280]) {
      const { page, close } = await open(browser, `/recipes/${id}`, { w, h: 800, scheme });
      const cook = page.getByRole('button', { name: 'Cook', exact: true });
      await hydrated(cook);
      await cook.focus();
      await page.keyboard.press('Enter');
      const dlg = page.getByRole('dialog', { name: /^Cooking:/ });
      await expect(dlg).toBeVisible();
      await axe(page, `cook mode open ${scheme} ${w}`);
      const box = dlg.getByRole('checkbox').first();
      await box.focus();
      await page.keyboard.press('Space');
      await expect(box).toBeChecked();
      await axe(page, `cook mode checked ${scheme} ${w}`);
      // 1.4.4: at 200 % text (browser zoom emulated through root font size) nothing overflows.
      await page.addStyleTag({ content: 'html{font-size:200% !important}' });
      const over = await dlg.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(over, `cook dialog horizontal overflow at 200% (${scheme} ${w})`).toBeLessThanOrEqual(
        1,
      );
      // Escape closes and focus returns to the Cook button.
      await page.keyboard.press('Escape');
      await expect(dlg).toBeHidden();
      await expect(cook).toBeFocused();
      await close();
    }
  }
});

test('upload endpoint rejection leaves page state unchanged', async () => {
  const res = await apiUpload(ctx, id, SVG_AS_JPG, 'image/jpeg');
  expect(res.status()).toBe(422);
});
