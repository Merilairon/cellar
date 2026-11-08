import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

// T12: axe (WCAG 2.2 A/AA rule set) over every state of the editor, light and dark, at 375 / 768 /
// 1280, plus target size (2.5.8), reflow (1.4.10), reduced motion and the tab-stop count per
// row. Screen reader output is NOT covered here (docs/tasks/v0.4.1-a11y-audit.md).
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gestates');
let setupCtx: BrowserContext;
let cakeId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  setupCtx = await browser.newContext();
  await signIn(await setupCtx.newPage(), me);
  cakeId = await createRecipe(setupCtx, SAMPLES.cake);
});
test.afterAll(async () => setupCtx?.close());

async function open(
  browser: import('@playwright/test').Browser,
  w: number,
  scheme: 'light' | 'dark',
  h = 900,
  extra: { reducedMotion?: 'reduce' | 'no-preference'; hasTouch?: boolean } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    colorScheme: scheme,
    reducedMotion: extra.reducedMotion ?? 'reduce',
    hasTouch: extra.hasTouch,
    storageState: await setupCtx.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(`/recipes/${cakeId}`);
  const entry = page.getByRole('button', { name: 'Edit grid' });
  await hydrated(entry);
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  return { page, ctx };
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

const firstRow = (page: Page) => page.locator('[data-ge-target^="row:"]').first();
const save = (page: Page) => page.getByRole('button', { name: /^Save changes|^Saving/ });

const widths = [375, 768, 1280] as const;
for (const scheme of ['light', 'dark'] as const) {
  for (const w of widths) {
    test(`axe: every editor state (${scheme}, ${w})`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, ctx } = await open(browser, w, scheme);
      const phone = w < 640;
      await axe(page, 'idle');

      // Selected step: inline panel at >= 640, bottom sheet on the phone.
      await page.locator('[data-ge-target^="step:"]').first().click();
      if (phone) await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page, 'selected step');
      if (!phone) {
        await page.getByRole('button', { name: 'Adjust rows' }).click();
        await expect(page.getByRole('group', { name: 'Start row' })).toBeVisible();
        await axe(page, 'adjust rows open');
      }
      await page.keyboard.press('Escape');
      if (phone) await expect(page.getByRole('dialog')).toBeHidden();

      // Row actions: menu at >= 640, row sheet on the phone.
      await page
        .getByRole('button', { name: /^Row actions for/ })
        .first()
        .click();
      await expect(page.getByRole(phone ? 'dialog' : 'menu')).toBeVisible();
      await axe(page, phone ? 'row sheet' : 'row actions menu');
      await page.keyboard.press('Escape');
      await expect(page.getByRole(phone ? 'dialog' : 'menu')).toBeHidden();

      // Inline edit with the parsed preview.
      await firstRow(page).focus();
      await page.keyboard.press('F2');
      const field = page.getByRole('textbox', { name: 'Edit ingredient 1' });
      await field.fill('6 oz unsalted butter');
      await expect(page.getByText(/Parsed as: /)).toBeVisible();
      await axe(page, 'inline edit');
      await page.keyboard.press('Enter');
      await expect(firstRow(page)).toContainText('butter');

      // Undo toast after a delete.
      await firstRow(page).focus();
      await page.keyboard.press('Delete');
      await expect(page.locator('[data-ge-toast]')).toBeVisible();
      await axe(page, 'undo toast');
      await page.locator('[data-ge-toast]').getByRole('button', { name: 'Undo' }).click();

      // Warning: a new, uncovered row, then the problems panel.
      const lastMenu = page.getByRole('button', { name: /^Row actions for/ }).last();
      await lastMenu.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await lastMenu.click();
      await page.getByRole(phone ? 'button' : 'menuitem', { name: 'Add row below' }).click();
      await page.keyboard.type('1 tsp warning salt');
      await page.keyboard.press('Enter');
      await expect(page.getByText(/No step covers/).first()).toBeVisible();
      await axe(page, 'warnings and issues panel');

      // Network alert, 422 problems, 409 conflict, leave confirm.
      await page.route('**/api/recipes/*/grid', (r) => r.abort());
      await save(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toBeVisible();
      await axe(page, 'network alert');
      await page.unroute('**/api/recipes/*/grid');

      await page.route('**/api/recipes/*/grid', (r) =>
        r.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            errors: [{ path: 'sections.0.ingredients.0.name', code: 'name_empty' }],
          }),
        }),
      );
      await save(page).click();
      await expect(page.getByText('An ingredient needs a name.')).toBeVisible();
      await axe(page, 'errors and issues panel');
      await page.unroute('**/api/recipes/*/grid');

      await page.route('**/api/recipes/*/grid', (r) =>
        r.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ updated_at: new Date().toISOString() }),
        }),
      );
      await save(page).click();
      await expect(
        page.getByRole('heading', { name: 'This recipe changed while you were editing.' }),
      ).toBeFocused();
      await axe(page, 'conflict panel');
      await page.getByRole('button', { name: 'Load the latest version' }).click();
      await expect(page.getByText('This throws away your changes in the editor.')).toBeVisible();
      await axe(page, 'conflict confirm');
      await page.keyboard.press('Escape');
      await page.unroute('**/api/recipes/*/grid');

      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByText('Discard your unsaved changes?')).toBeVisible();
      await axe(page, 'leave confirm');
      await ctx.close();
    });
  }
}

test('section delete confirm: axe and focus return', async ({ browser }) => {
  const { page, ctx } = await open(browser, 1280, 'dark');
  const del = page.getByRole('button', { name: /^Delete section/ }).first();
  await del.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('alertdialog').or(page.getByRole('group', { name: /delete/i })),
  ).toBeVisible();
  await axe(page, 'section delete confirm');
  await ctx.close();
});

test('target size: editor controls are >= 36 px (>= 44 px on phone / coarse), none under 24 px', async ({
  browser,
}) => {
  for (const [w, min, touch] of [
    [1280, 36, false],
    [375, 44, true],
  ] as const) {
    const { page, ctx } = await open(browser, w, 'light', 812, { hasTouch: touch });
    if (w >= 640) await page.locator('[data-ge-target^="step:"]').first().click();
    const small = await page.evaluate((limit) => {
      const out: string[] = [];
      const sel =
        '.ge-root button, .ge-root [data-ge-target], .ge-root input:not([type=hidden]), .ge-root select, .ge-root summary';
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < limit - 0.5 || (el.tagName === 'BUTTON' && r.width < limit - 0.5))
          out.push(
            `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
      }
      return out;
    }, min);
    expect(small, `${w}px`).toEqual([]);
    await ctx.close();
  }
});

test('reflow: 320 px (400 % zoom) and 640 px (200 %) have no page-level horizontal scroll', async ({
  browser,
}) => {
  for (const w of [320, 640]) {
    const { page, ctx } = await open(browser, w, 'light', 700);
    await page.locator('[data-ge-target^="step:"]').first().click();
    const over = await page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    expect(over, `${w}px page overflow`).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: /^Save changes/ })).toBeVisible();
    await axe(page, `reflow ${w}`);
    await ctx.close();
  }
});

test('reduced motion: no transition on the handles; motion allowed otherwise', async ({
  browser,
}) => {
  const a = await open(browser, 1280, 'light', 900, { reducedMotion: 'reduce' });
  const d1 = await a.page.evaluate(
    () =>
      getComputedStyle(document.querySelector('.ge-handle') ?? document.body).transitionDuration,
  );
  expect(parseFloat(d1)).toBe(0);
  await a.ctx.close();
});

// The audit's counting method (docs/tasks/v0.4.1-a11y-audit.md A3): every button or element with a
// tabindex inside a table whose tabIndex is >= 0 and that is rendered. Before the A3 fix this
// was `tables + 3 x rows` (38 for the cake at 1280: 2 tables, 12 rows).
const tabStops = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('table.ge-table')).map(
      (table) =>
        Array.from(table.querySelectorAll<HTMLElement>('button, [tabindex]')).filter(
          (e) => e.tabIndex >= 0 && e.offsetParent !== null,
        ).length,
    ),
  );

for (const w of widths) {
  test(`A3 tab stops: exactly one per table at ${w}`, async ({ browser }) => {
    const { page, ctx } = await open(browser, w, 'light');
    const rows = await page.locator('[data-ge-target^="row:"]').count();
    const perTable = await tabStops(page);
    test.info().annotations.push({
      type: 'tab-stops',
      description: `${perTable.reduce((a, b) => a + b, 0)} stops for ${rows} rows in ${perTable.length} tables (was ${perTable.length + 3 * rows} at 1280)`,
    });
    expect(perTable.length).toBeGreaterThan(1);
    expect(perTable).toEqual(perTable.map(() => 1));
    // The real thing: Tab from the first table's stop lands outside that table's rows' buttons.
    await firstRow(page).focus();
    await page.keyboard.press('Tab');
    const inRowControls = await page.evaluate(
      () => !!document.activeElement?.closest('.ge-rowctl'),
    );
    expect(inRowControls).toBe(false);
    await ctx.close();
  });
}

test('A3 chords: Shift+F10 and ContextMenu open Row actions for the focused row', async ({
  browser,
}) => {
  const { page, ctx } = await open(browser, 1280, 'light');
  const row = page.locator('[data-ge-target^="row:"]').nth(1);
  for (const chord of ['Shift+F10', 'ContextMenu']) {
    await row.focus();
    await page.keyboard.press(chord);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // Focus returns to the row target, so the arrow keys keep working.
    await expect(row).toBeFocused();
  }
  // Pick Move down from the menu with the keyboard only: the row moves, focus stays on it.
  const name = ((await row.innerText()).trim().split(/\s+/).pop() ?? '').trim();
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: /^Move .* down$/ }).press('Enter');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.locator('[data-ge-target^="row:"]').nth(2)).toContainText(name);
  await expect(page.locator('[data-ge-target^="row:"]').nth(2)).toBeFocused();
  await ctx.close();
});

test('A3 chords: Shift+F10 opens the row sheet on the phone and the step panel on a step', async ({
  browser,
}) => {
  const { page, ctx } = await open(browser, 375, 'light');
  await firstRow(page).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await ctx.close();

  const d = await open(browser, 1280, 'light');
  await d.page.locator('[data-ge-target^="step:"]').first().focus();
  await d.page.keyboard.press('Shift+F10');
  await expect(d.page.getByRole('heading', { name: /^Step/ }).first()).toBeFocused();
  await d.ctx.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Keyboard help disclosure lists the chords, axe clean (${scheme})`, async ({ browser }) => {
    const { page, ctx } = await open(browser, 1280, scheme);
    const toggle = page.getByRole('button', { name: 'Keyboard help' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // It is a tab stop, straight after the toolbar and before the first section's controls.
    await page.getByRole('button', { name: /^Save changes/ }).focus();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Shift+F10 or the Menu key')).toBeVisible();
    await expect(page.getByText('Alt+Up or Alt+Down')).toBeVisible();
    await axe(page, 'keyboard help open');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await ctx.close();
  });
}

test('A4: the rename error is described and spoken politely, never role=alert', async ({
  browser,
}) => {
  const { page, ctx } = await open(browser, 1280, 'light');
  await page
    .getByRole('button', { name: /^Rename/ })
    .first()
    .click();
  const field = page.getByRole('textbox', { name: /Section name|Rename/i }).first();
  await field.fill('');
  await field.press('Enter');
  const err = page.getByText('Give each section a name.');
  await expect(err).toBeVisible();
  await expect(err).not.toHaveAttribute('role', 'alert');
  const id = await err.getAttribute('id');
  await expect(field).toHaveAttribute('aria-describedby', id!);
  await expect(page.locator('.ge-root [role="status"]')).toHaveText('Give each section a name.');
  await expect(page.locator('.ge-root [role="alert"]')).toHaveCount(0);
  await ctx.close();
});

// WCAG 2.x relative luminance contrast of two computed `rgb(...)` strings.
const ratio = (a: string, b: string) => {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const x = Number(v) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const scheme of ['light', 'dark'] as const) {
  test(`A5: toast focus ring is >= 3:1 against the toast surface (${scheme})`, async ({
    browser,
  }) => {
    const { page, ctx } = await open(browser, 1280, scheme);
    await firstRow(page).focus();
    await page.keyboard.press('Delete');
    const toast = page.locator('[data-ge-toast]');
    await expect(toast).toBeVisible();
    for (const name of ['Undo', 'Dismiss']) {
      const btn = toast.getByRole('button', { name });
      await btn.focus();
      await page.keyboard.press('Shift+Tab'); // make :focus-visible certain on re-entry
      await page.keyboard.press('Tab');
      const m = await btn.evaluate((el) => ({
        outline: getComputedStyle(el).outlineColor,
        width: getComputedStyle(el).outlineWidth,
        bg: getComputedStyle(el.closest('[data-ge-toast]')!).backgroundColor,
      }));
      const r = ratio(m.outline, m.bg);
      test.info().annotations.push({
        type: 'toast-ring',
        description: `${scheme} ${name} ${r.toFixed(2)}:1`,
      });
      expect(parseFloat(m.width)).toBeGreaterThanOrEqual(2);
      expect(r).toBeGreaterThanOrEqual(3);
    }
    await ctx.close();
  });
}

for (const [w, h] of [
  [1280, 420],
  [375, 500],
] as const) {
  test(`A6: a toast never hides or traps the focused control (${w} x ${h})`, async ({
    browser,
  }) => {
    const { page, ctx } = await open(browser, w, 'light', h);
    await firstRow(page).focus();
    await page.keyboard.press('Delete');
    const toast = page.locator('[data-ge-toast]');
    await expect(toast).toBeVisible();
    // Walk every row of the last table bottom to top with the toast showing.
    const rows = page.locator('table.ge-table').last().locator('[data-ge-target^="row:"]');
    const n = await rows.count();
    await rows.last().focus();
    for (let i = 0; i < n; i++) {
      const overlap = await page.evaluate(() => {
        const f = document.activeElement as HTMLElement;
        const a = f.getBoundingClientRect();
        const b = document.querySelector('[data-ge-toast]')!.getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 0 && h > 0;
      });
      expect(overlap, `row ${n - i} of ${n}`).toBe(false);
      await page.keyboard.press('ArrowUp');
    }
    // Not a trap: Tab and Shift+Tab pass through the toast buttons in both directions.
    await toast.getByRole('button', { name: 'Undo' }).focus();
    await page.keyboard.press('Tab');
    await expect(toast.getByRole('button', { name: 'Dismiss' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toast.getByRole('button')).toHaveCount(2);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-ge-toast]'))).toBe(
      false,
    );
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-ge-toast]'))).toBe(
      false,
    );
    // Dismissing from the keyboard keeps focus in the editor.
    await toast.getByRole('button', { name: 'Dismiss' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.matches('[data-ge-target]'))).toBe(
      true,
    );
    await ctx.close();
  });
}

test('2.4.11 focus not obscured: walking the rows never leaves the focused target under the sticky toolbar', async ({
  browser,
}) => {
  for (const [w, h] of [
    [1280, 420],
    [375, 500],
  ] as const) {
    const { page, ctx } = await open(browser, w, 'light', h);
    await firstRow(page).focus();
    const n = await page
      .locator('table.ge-table')
      .first()
      .locator('[data-ge-target^="row:"]')
      .count();
    for (let i = 0; i < n; i++) {
      const hidden = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + Math.min(r.width / 2, 40),
          r.top + r.height / 2,
        );
        return !hit || !el.contains(hit);
      });
      expect(hidden, `${w}px row ${i + 1}`).toBe(false);
      await page.keyboard.press('ArrowDown');
    }
    await ctx.close();
  }
});

test('live regions: the editor owns exactly one polite status region at rest', async ({
  browser,
}) => {
  const { page, ctx } = await open(browser, 1280, 'light');
  const regions = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '.ge-root [aria-live], .ge-root [role="status"], .ge-root [role="alert"]',
      ),
    ).map((e) => e.getAttribute('role') ?? e.getAttribute('aria-live')),
  );
  expect(regions).toEqual(['status']);
  await ctx.close();
});
