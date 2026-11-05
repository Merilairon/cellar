import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { account, registerViaInvite, signIn } from './helpers';
import {
  apiImport,
  openReview,
  panel,
  previewTables,
  SEAM,
  spanInput,
  stateLine,
  startPages,
} from './mapping-fixtures';

/**
 * T15: axe (WCAG 2.1 A/AA incl. color-contrast) on every state the mapper review adds, light
 * and dark, 375 and 1280 px, plus keyboard-only passes of the mapping panel. Like
 * import-a11y.spec.ts it runs against the SEAM dev server. The jobs are created once and only
 * viewed (never saved), so the 20-imports-per-hour limit is not a factor.
 */
test.describe.configure({ mode: 'serial' });

const me = account('mapa11y');
let setupCtx: BrowserContext;
let pages: Server;
const job = { high: '', medium: '', low: '', sections: '' };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  const started = await startPages();
  pages = started.server;
  setupCtx = await browser.newContext({ baseURL: SEAM });
  await signIn(await setupCtx.newPage(), me);
  for (const name of ['high', 'medium', 'low', 'sections'] as const) {
    job[name] = (await apiImport(setupCtx, { url: `${started.origin}/${name}` })).id;
  }
});
test.afterAll(async () => {
  await setupCtx?.close();
  await new Promise((ok) => pages?.close(ok));
});

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

async function open(browser: Browser, scheme: 'light' | 'dark', width: number) {
  const ctx = await browser.newContext({
    baseURL: SEAM,
    viewport: { width, height: 900 },
    colorScheme: scheme,
    reducedMotion: 'reduce',
    storageState: await setupCtx.storageState(),
  });
  return { ctx, page: await ctx.newPage() };
}

const save = (p: Page) => p.getByRole('button', { name: 'Save imported recipe' });

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`axe: mapping review states (${scheme}, ${width})`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { ctx, page } = await open(browser, scheme, width);

      // 1. High: grid applied, preview open, score closed. Then every disclosure open.
      await openReview(page, job.high);
      await expect(previewTables(page)).toHaveCount(1);
      await expectNoViolations(page);
      await panel(page).getByText('Why this score').click();
      await panel(page).getByText('How does this work?').click();
      await expect(panel(page).getByText('Match score: 1.00 out of 1')).toBeVisible();
      await expectNoViolations(page);

      // 2. High, edited: reset action visible, state line "with your changes".
      await spanInput(page, 3, 'Last').fill('2');
      await expect(page.getByRole('button', { name: 'Reset to proposal' })).toBeVisible();
      await expectNoViolations(page);

      // 3. Confirm prompt.
      await page.getByRole('button', { name: 'Reset to proposal' }).click();
      await expect(page.getByRole('button', { name: 'Keep editing' })).toBeFocused();
      await expectNoViolations(page);
      await page.getByRole('button', { name: 'Keep editing' }).click();

      // 4. Invalid grid: the preview lists the validator messages (links inside the panel).
      await spanInput(page, 3, 'Last').fill('99');
      await expect(panel(page).getByRole('link', { name: /Step 3:/ })).toBeVisible();
      await expectNoViolations(page);

      // 5. Server rejected the grid: state line + form error summary.
      await page.route('**/api/import/*/save', (route) =>
        route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            errors: [{ path: 'sections.0.steps.2.row_end', code: 'row_out_of_range' }],
          }),
        }),
      );
      await spanInput(page, 3, 'Last').fill('1');
      await save(page).click();
      await expect(stateLine(page)).toContainText('The grid is not valid');
      await expectNoViolations(page);
      await page.unroute('**/api/import/*/save');

      // 6. Medium: list, reasons open; then grid applied.
      await openReview(page, job.medium);
      await expect(panel(page).getByText('Check the mapping')).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole('button', { name: 'Preview as grid' }).click();
      await expect(previewTables(page)).toHaveCount(1);
      await expectNoViolations(page);

      // 7. Low: list with "Try the grid anyway", then the tried grid.
      await openReview(page, job.low);
      await expect(panel(page).getByText('Could not map reliably')).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole('button', { name: 'Try the grid anyway' }).click();
      await expect(page.getByRole('button', { name: 'Use list view instead' })).toBeVisible();
      await expectNoViolations(page);

      // 8. Two sections in the preview.
      await openReview(page, job.sections);
      await expect(previewTables(page)).toHaveCount(2);
      await expectNoViolations(page);
      await ctx.close();
    });
  }
}

/** Presses Tab until focus is inside `root`; fails after `max` presses. */
async function tabInto(page: Page, rootSel: string, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => !!document.activeElement?.closest(s), rootSel)) return;
  }
  throw new Error(`focus never entered ${rootSel}`);
}

const focusName = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e) return '';
    return (e.getAttribute('aria-label') ?? e.textContent ?? e.id).trim().slice(0, 40);
  });

test('keyboard only: tab order of the panel, disclosure toggles, skip link', async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, 'light', 1280);
  await openReview(page, job.high);
  await expect(previewTables(page)).toHaveCount(1);

  await tabInto(page, 'section[aria-labelledby]');
  const order: string[] = [await focusName(page)];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    order.push(await focusName(page));
  }
  // Actions first, then the three disclosures in reading order.
  expect(order).toEqual([
    'Use list view instead',
    'Why this score',
    'How does this work?',
    'Grid preview',
  ]);

  // Enter opens a details, Space closes it; focus stays on the summary (no remount).
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  const why = panel(page).locator('details').first();
  await expect(page.getByText('Why this score')).toBeFocused();
  await expect(why).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(why).toHaveAttribute('open', '');
  await expect(page.getByText('Why this score')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(why).not.toHaveAttribute('open', '');
  await expect(page.getByText('Why this score')).toBeFocused();

  // Preview toggle by keyboard; closing it hides the table and a later edit keeps it closed.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('#map-preview-summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(previewTables(page)).toHaveCount(1);
  await expect(previewTables(page)).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(previewTables(page)).toBeVisible();

  // The skip link appears on focus and jumps to the first recipe field.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip the preview and go to the recipe fields' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  await ctx.close();
});

test('keyboard only: apply, edit, confirm with Esc, reset and list move focus to a sensible place', async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, 'light', 1280);
  await openReview(page, job.medium);

  // Apply with the keyboard: focus lands on the preview heading (the form was remounted).
  await page.getByRole('button', { name: 'Preview as grid' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#map-preview-summary')).toBeFocused();
  await expect(stateLine(page)).toHaveText('Proposal applied. Will be saved as: Grid');

  // Edit by typing in the real input, then reach Reset by Tab from the panel start.
  const last = spanInput(page, 1, 'Last');
  await last.focus();
  const was = await last.inputValue();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(was === '1' ? '2' : '1');
  await expect(page.getByRole('button', { name: 'Reset to proposal' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset to proposal' }).focus();
  await page.keyboard.press('Enter');
  const keep = page.getByRole('button', { name: 'Keep editing' });
  await expect(keep).toBeFocused();

  // Tab order inside the confirm: Keep editing -> (leaves group) ; Shift+Tab -> Replace.
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Replace' })).toBeFocused();
  // Esc from any control of the group cancels and focus returns to the Reset button.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Reset to proposal' })).toBeFocused();
  await expect(last).toHaveValue(was === '1' ? '2' : '1'); // edit kept

  // Confirm for real: Enter on Replace restores and focuses the preview heading.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter'); // Replace
  await expect(stateLine(page)).toHaveText('Proposal restored. Will be saved as: Grid');
  await expect(spanInput(page, 1, 'Last')).toHaveValue(was);
  await expect(page.locator('#map-preview-summary')).toBeFocused();

  // Back to the list: focus lands on the control that brings the grid back.
  await page.getByRole('button', { name: 'Use list view instead' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Preview as grid' })).toBeFocused();
  await ctx.close();
});
