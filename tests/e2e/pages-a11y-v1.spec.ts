import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  ADMIN,
  createRecipe,
  hydrated,
  registerViaInvite,
  SAMPLES,
  signIn,
} from './helpers';
import { importedCake, linkSwitch, openShare, recipeWithLink } from './share-support';

// v1.0 accessibility fixes (docs/tasks/v1.0-a11y-fixes.md): F1/F9 page titles, F2 to F4 forced
// colours, F5 disabled-button contrast, F6/F8 200 % text, and the cheap Lows F7, F11, F12, F13,
// F15, F17. Chromium only; the forced-colors check is the emulation, not a real contrast theme.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const me = account('a11yv1');
const other = account('a11yv1other');
const LONG_TITLE =
  'Slow Roasted Shoulder Of Lamb With Preserved Lemon And Green Olive Tagine Served On Saffron Couscous';
let ctx: BrowserContext;
let otherCtx: BrowserContext;
let adminCtx: BrowserContext;
const ids = { cake: '', long: '', private: '' };
let publicUrl = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  await registerViaInvite(browser, other);
  ctx = await browser.newContext();
  await signIn(await ctx.newPage(), me);
  otherCtx = await browser.newContext();
  await signIn(await otherCtx.newPage(), other);
  adminCtx = await browser.newContext();
  await signIn(await adminCtx.newPage(), ADMIN);
  ids.cake = await createRecipe(ctx, { ...SAMPLES.cake, title: 'A11yv1 Cake' });
  ids.long = await createRecipe(ctx, { ...SAMPLES.cookie, title: LONG_TITLE });
  ids.private = await createRecipe(ctx, { ...SAMPLES.cookie, title: 'A11yv1 Secret Recipe' });
  publicUrl = (await recipeWithLink(ctx, importedCake('A11yv1 Public Cake'))).url;
});
test.afterAll(async () => {
  await ctx?.close();
  await otherCtx?.close();
  await adminCtx?.close();
});

async function titleOf(c: BrowserContext, path: string) {
  const p = await c.newPage();
  await p.goto(path);
  const title = await p.title();
  await p.close();
  return title;
}

// ---------- F1, F9: page titles ----------

test('F1: every route has its own descriptive title', async ({ browser }) => {
  const signedIn: Array<[string, string]> = [
    ['/', 'Home · Cellar'],
    ['/recipes', 'Recipes · Cellar'],
    ['/recipes/new', 'New recipe · Cellar'],
    [`/recipes/${ids.cake}`, 'A11yv1 Cake · Cellar'],
    [`/recipes/${ids.cake}/edit`, 'Edit recipe · Cellar'],
    ['/import', 'Import a recipe · Cellar'],
    ['/backup', 'Backup · Cellar'],
    ['/profile', 'Profile · Cellar'],
  ];
  const seen = new Map<string, string>();
  for (const [path, title] of signedIn) {
    expect(await titleOf(ctx, path), path).toBe(title);
    seen.set(title, path);
  }
  expect(await titleOf(adminCtx, '/admin/users')).toBe('Users · Cellar');
  const guest = await browser.newContext();
  expect(await titleOf(guest, '/login')).toBe('Sign in · Cellar');
  await guest.close();
  // Titles are unique across the list above (a tab list or history entry tells them apart).
  expect(seen.size).toBe(signedIn.length);
});

test('F1: the public page keeps its recipe title and noindex; invalid links share one 404 title', async ({
  browser,
}) => {
  const guest = await browser.newContext();
  const p = await guest.newPage();
  await p.goto(publicUrl);
  await expect(p).toHaveTitle('A11yv1 Public Cake · Cellar');
  await expect(p.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  const missing = [
    '/r/AAAAAAAAAAAAAAAAAAAAAA',
    '/r/abc',
    '/register/nope',
    '/reset/nope',
    '/setup',
  ];
  for (const path of missing) {
    expect(await titleOf(guest, path), path).toBe('Link not found · Cellar');
  }
  await guest.close();
  // A signed-in visitor on an unknown path gets the same page and title.
  expect(await titleOf(ctx, '/nowhere')).toBe('Link not found · Cellar');
});

test('F1: a recipe the viewer cannot read gets the 404 title, not its own', async () => {
  expect(await titleOf(otherCtx, `/recipes/${ids.private}`)).toBe('Link not found · Cellar');
  expect(await titleOf(otherCtx, `/recipes/${ids.private}/edit`)).toBe('Link not found · Cellar');
});

// ---------- F11: the 404 ----------

test('F11: the uniform 404 has an h1 and a link onward, and axe finds no heading rule hit', async ({
  browser,
}) => {
  const guest = await browser.newContext();
  const p = await guest.newPage();
  await p.goto('/r/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(p.getByRole('heading', { level: 1, name: 'Link not found' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'Go to Cellar' })).toHaveAttribute('href', '/');
  const { violations } = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await guest.close();
});

// ---------- F2, F3, F4: forced colours ----------

const NOT_TRANSPARENT = (c: string) => !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(c);

test.describe('forced colors', () => {
  test('F2: a pressed toggle looks different from an unpressed one', async ({ browser }) => {
    const c = await browser.newContext({
      forcedColors: 'active',
      storageState: await ctx.storageState(),
    });
    const page = await c.newPage();
    await page.goto(`/recipes/${ids.cake}`);
    const group = page.getByRole('group', { name: 'Scale' });
    await hydrated(group.getByRole('button').first());
    const pressed = group.getByRole('button', { pressed: true });
    const unpressed = group.getByRole('button', { pressed: false }).first();
    const look = (l: typeof pressed) =>
      l.evaluate((el) => {
        const s = getComputedStyle(el);
        return `${s.backgroundColor}|${s.color}`;
      });
    expect(await look(pressed)).not.toBe(await look(unpressed));
    // The Grid/List toggle uses the same rule.
    const view = page.getByRole('button', { name: 'Grid', exact: true });
    await expect(view).toHaveAttribute('aria-pressed', 'true');
    const list = page.getByRole('button', { name: 'List', exact: true });
    expect(await look(view)).not.toBe(await look(list));
    await c.close();
  });

  test('F3: the Public link switch has a bordered track and a visible knob', async ({
    browser,
  }) => {
    const c = await browser.newContext({
      forcedColors: 'active',
      storageState: await ctx.storageState(),
    });
    const page = await c.newPage();
    await page.goto(`/recipes/${ids.cake}`);
    const dialog = await openShare(page);
    const sw = linkSwitch(dialog);
    const parts = () =>
      sw.evaluate((el) => {
        const track = el.firstElementChild as HTMLElement;
        const knob = track.firstElementChild as HTMLElement;
        const t = getComputedStyle(track);
        const k = getComputedStyle(knob);
        return {
          border: t.borderTopWidth,
          borderColor: t.borderTopColor,
          track: t.backgroundColor,
          knob: k.backgroundColor,
        };
      });
    const off = await parts();
    expect(parseFloat(off.border)).toBeGreaterThanOrEqual(2);
    expect(NOT_TRANSPARENT(off.borderColor)).toBe(true);
    expect(off.knob).not.toBe(off.track);
    await sw.click();
    await expect(sw).toBeChecked();
    const on = await parts();
    expect(on.track).not.toBe(off.track); // on and off differ without colour names
    expect(on.knob).not.toBe(on.track);
    await c.close();
  });

  test('F4: primary buttons keep a visible border', async ({ browser }) => {
    const c = await browser.newContext({
      forcedColors: 'active',
      storageState: await ctx.storageState(),
    });
    const page = await c.newPage();
    await page.goto('/recipes');
    const create = page.getByRole('link', { name: 'New recipe' }).first();
    const s = await create.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { w: cs.borderTopWidth, color: cs.borderTopColor, style: cs.borderTopStyle };
    });
    expect(parseFloat(s.w)).toBeGreaterThanOrEqual(1);
    expect(s.style).toBe('solid');
    expect(NOT_TRANSPARENT(s.color)).toBe(true);
    await c.close();
  });
});

// ---------- F5: disabled primary contrast ----------

function contrastOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const px = (css: string) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return Array.from(g.getImageData(0, 0, 1, 1).data) as number[];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const s = getComputedStyle(el);
    const a = lum(px(s.color));
    const b = lum(px(s.backgroundColor));
    return {
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      opacity: s.opacity,
      shadow: s.boxShadow,
      bg: px(s.backgroundColor).join(','),
    };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`F5: the aria-disabled "Check the file" button reaches 4.5:1 and still looks disabled (${scheme})`, async ({
    browser,
  }) => {
    const c = await browser.newContext({
      colorScheme: scheme,
      storageState: await ctx.storageState(),
    });
    const page = await c.newPage();
    await page.goto('/backup');
    const btn = page.getByRole('button', { name: 'Check the file' });
    await hydrated(btn);
    await expect(btn).toHaveAttribute('aria-disabled', 'true');
    await btn.evaluate((el) => el.setAttribute('data-probe', 'dis'));
    const disabled = await contrastOf(page, '[data-probe=dis]');
    expect(disabled.ratio).toBeGreaterThanOrEqual(4.5);
    expect(disabled.opacity).toBe('1');
    expect(disabled.shadow).not.toBe('none'); // the outline that marks it unavailable
    // Enabled look for comparison: same button once a file is chosen.
    await page.locator('input[type=file]').setInputFiles({
      name: 'x.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    await expect(btn).toHaveAttribute('aria-disabled', 'false');
    const enabled = await contrastOf(page, '[data-probe=dis]');
    expect(enabled.bg).not.toBe(disabled.bg);
    expect(enabled.ratio).toBeGreaterThanOrEqual(4.5);
    await c.close();
  });
}

// ---------- F6, F8: 200 % text at 375 px ----------

test('F6: scale and view controls wrap instead of clipping at 375 px with 200 % text', async ({
  browser,
}) => {
  const c = await browser.newContext({
    viewport: { width: 375, height: 812 },
    storageState: await ctx.storageState(),
  });
  const page = await c.newPage();
  await page.goto(`/recipes/${ids.cake}`);
  await hydrated(page.getByRole('group', { name: 'Scale' }).getByRole('button').first());
  await page.addStyleTag({ content: 'html{font-size:200%}' });
  const group = page.getByRole('group', { name: 'Scale' });
  const custom = group.getByRole('button', { name: 'Custom' });
  await expect(custom).toBeVisible();
  const clipped = await group.evaluate((el) => {
    const g = el.getBoundingClientRect();
    return {
      scrollOverflow: el.scrollWidth - el.clientWidth,
      buttons: Array.from(el.querySelectorAll('button')).map((b) => {
        const r = b.getBoundingClientRect();
        return { name: b.textContent, left: r.left, right: r.right };
      }),
      groupRight: g.right,
      vw: document.documentElement.clientWidth,
    };
  });
  expect(clipped.scrollOverflow).toBeLessThanOrEqual(0);
  for (const b of clipped.buttons) {
    expect(b.left, b.name ?? '').toBeGreaterThanOrEqual(0);
    expect(b.right, b.name ?? '').toBeLessThanOrEqual(clipped.vw);
  }
  expect(clipped.groupRight).toBeLessThanOrEqual(clipped.vw);
  await c.close();
});

test('F8: the cook-mode heading is fully readable at 375 px with 200 % text', async ({
  browser,
}) => {
  const c = await browser.newContext({
    viewport: { width: 375, height: 812 },
    storageState: await ctx.storageState(),
  });
  const page = await c.newPage();
  await page.goto(`/recipes/${ids.long}`);
  const cook = page.getByRole('button', { name: 'Cook', exact: true });
  await hydrated(cook);
  await page.addStyleTag({ content: 'html{font-size:200%}' });
  await cook.click();
  const heading = page
    .getByRole('dialog', { name: /^Cooking:/ })
    .getByRole('heading', { level: 2 });
  await expect(heading).toBeVisible();
  const m = await heading.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      overflow: el.scrollWidth - el.clientWidth,
      textOverflow: s.textOverflow,
      title: el.getAttribute('title'),
      lines: el.getBoundingClientRect().height / parseFloat(s.lineHeight),
    };
  });
  expect(m.title).toBeNull(); // no tooltip-only disclosure
  expect(m.textOverflow).not.toBe('ellipsis');
  expect(m.overflow).toBeLessThanOrEqual(0);
  expect(m.lines).toBeGreaterThan(1.5); // it wrapped, the whole title is on screen
  await c.close();
});

// ---------- Cheap Lows ----------

test('F7, F12, F15: user menu is not a "menu" popup, brand link is 36 px, Escape closes the 375 px menu', async ({
  browser,
}) => {
  const c = await browser.newContext({
    viewport: { width: 375, height: 812 },
    storageState: await ctx.storageState(),
  });
  const page = await c.newPage();
  await page.goto('/recipes');
  const account = page.getByRole('button', { name: /^Account menu:/ });
  await hydrated(account);
  await expect(account).not.toHaveAttribute('aria-haspopup', /.*/);
  const brand = page.getByRole('banner').getByRole('link', { name: 'Cellar', exact: true });
  expect((await brand.boundingBox())!.height).toBeGreaterThanOrEqual(36);

  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: 'Recipes', exact: true }).first().focus();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await c.close();
});

test('F13: the confirm group is named by its own question, not a duplicate label', async ({
  browser,
}) => {
  const c = await browser.newContext({ storageState: await ctx.storageState() });
  const page = await c.newPage();
  const id = await createRecipe(ctx, { ...SAMPLES.cookie, title: 'A11yv1 Share Walk' });
  await page.goto(`/recipes/${id}`);
  const dialog = await openShare(page);
  await linkSwitch(dialog).click();
  await expect(linkSwitch(dialog)).toBeChecked();
  await linkSwitch(dialog).click();
  const group = dialog.getByRole('group', { name: /^Turn off the public link\?/ });
  await expect(group).toBeVisible();
  await expect(group).not.toHaveAttribute('aria-label', /.*/);
  await expect(group).toHaveAttribute('aria-labelledby', /\S/);
  await c.close();
});

test('F17: the new-recipe form never skips a heading level', async ({ browser }) => {
  const c = await browser.newContext({ storageState: await ctx.storageState() });
  const page = await c.newPage();
  await page.goto('/recipes/new');
  const ingredients = page.getByLabel(/^Ingredients/).first();
  await hydrated(ingredients);
  await ingredients.fill('2 cups flour\n1 tsp salt');
  await expect(page.getByRole('heading', { name: 'How each line is read' })).toBeVisible();
  const levels = await page
    .locator('main h1, main h2, main h3, main h4, main h5, main h6')
    .evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
  for (let i = 1; i < levels.length; i++) {
    expect(
      levels[i] - levels[i - 1],
      `heading ${i} after ${levels.slice(0, i).join(',')}`,
    ).toBeLessThanOrEqual(1);
  }
  await c.close();
});
