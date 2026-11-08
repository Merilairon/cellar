import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { account, captureConsole, registerViaInvite, signIn } from './helpers';
import {
  apiImport,
  hydrated,
  openReview,
  panel,
  PASTE_TEXT,
  previewTables,
  rowSpans,
  SEAM,
  SEAM_ORIGIN,
  spanInput,
  stateLine,
  startPages,
  tamperDraft,
} from './mapping-fixtures';

/**
 * T15: the mapper review flow (T11/T12/T13) in a real browser. Every job is created through
 * POST /api/import (setup via the API); the UI under test is the review screen and the saved
 * recipe page. Runs on the SEAM dev server (:3101) like import.spec.ts. The import rate limit
 * is 20 per user per hour, so the specs of this feature use their own users.
 */
test.describe.configure({ mode: 'serial' });

const me = account('mapper');
let ctx: BrowserContext;
let page: Page;
let pages: Server;
let fx = '';
let n = 0; // distinct URL per job: a saved recipe of the same URL would add a duplicate banner
const url = (name: string) => `${fx}/${name}-${++n}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  ({ server: pages, origin: fx } = await startPages());
  ctx = await browser.newContext({ baseURL: SEAM });
  page = await ctx.newPage();
  await signIn(page, me);
});
test.afterAll(async () => {
  await ctx?.close();
  await new Promise((ok) => pages?.close(ok));
});

const recipeCount = async () => {
  const res = await ctx.request.get('/api/recipes');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { recipes: unknown[] }).recipes.length;
};

const save = (p: Page) => p.getByRole('button', { name: 'Save imported recipe' });

/** Saved recipe page: asserts the structure of the grid (not pixels). */
async function expectSavedGrid(p: Page, title: string) {
  await expect(p).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(p.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

test('high confidence: opens as grid with preview, saves as grid, recipe page renders the grid', async () => {
  const cap = captureConsole(page);
  const job = await apiImport(ctx, { url: url('high') });
  expect(job.mapping_level).toBe('high');
  const before = await recipeCount();
  await openReview(page, job.id);

  await expect(panel(page).getByText('Good match')).toBeVisible();
  await expect(stateLine(page)).toHaveText('Proposal applied. Will be saved as: Grid');
  await expect(page.getByRole('button', { name: 'Preview as grid' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use list view instead' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset to proposal' })).toHaveCount(0); // not edited
  // Score disclosure is closed for a good match and open otherwise.
  const why = panel(page).locator('details').first();
  await expect(why).not.toHaveAttribute('open', '');
  // Preview: same structure as sample A on the recipe page (banners, 9 rows, five columns).
  await expect(panel(page).getByText('Grid preview')).toBeVisible();
  const tables = previewTables(page);
  await expect(tables).toHaveCount(1);
  await expect(tables.locator('td.rg-banner')).toHaveCount(2);
  await expect(tables.locator('tbody th[scope="row"]')).toHaveCount(9);
  expect(await rowSpans(tables)).toEqual([1, 4, 5, 9, 9]);
  // The ingredient textarea keeps the proposal order and the step rows carry the spans.
  await expect(spanInput(page, 3, 'First')).toHaveValue('1');
  await expect(spanInput(page, 3, 'Last')).toHaveValue('1');
  await expect(spanInput(page, 4, 'Last')).toHaveValue('4');

  await save(page).click();
  await expectSavedGrid(page, 'Fixture Skillet Cookie');
  const saved = page.locator('table.rg-table');
  await expect(saved).toHaveCount(1);
  await expect(saved.locator('td.rg-banner')).toHaveCount(2);
  await expect(saved.locator('tbody th[scope="row"]')).toHaveCount(9);
  expect(await rowSpans(saved)).toEqual([1, 4, 5, 9, 9]);
  expect(await recipeCount()).toBe(before + 1);
  expect(cap.hydrationMessages()).toEqual([]);
});

test('medium confidence: opens as list, "Preview as grid" applies the proposal, edit redraws, save as grid', async () => {
  const job = await apiImport(ctx, { url: url('medium') });
  expect(job.mapping_level).toBe('medium');
  await openReview(page, job.id);

  await expect(panel(page).getByText('Check the mapping')).toBeVisible();
  await expect(stateLine(page)).toHaveText('Will be saved as: List');
  await expect(panel(page).getByText('Grid preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try the grid anyway' })).toHaveCount(0);
  // Reasons are open by default below "high" and show the (closed set) score text.
  await expect(panel(page).getByText('Match score: 0.55 out of 1')).toBeVisible();
  // Page order, no spans.
  await expect(spanInput(page, 1, 'First')).toHaveValue('');

  await page.getByRole('button', { name: 'Preview as grid' }).click();
  await expect(stateLine(page)).toHaveText('Proposal applied. Will be saved as: Grid');
  await expect(page.locator('#map-preview-summary')).toBeFocused(); // form remounted, focus moved
  await expect(previewTables(page)).toHaveCount(1);
  const spans = await rowSpans(previewTables(page));
  expect(spans.length).toBeGreaterThan(0);

  // Edit one span: the preview redraws from form state (no request) and the state line says so.
  const colIdx = (
    await page
      .getByRole('group', { name: /^Step \d+$/ })
      .evaluateAll((els) => els.map((e) => (e.querySelector('select') as HTMLSelectElement).value))
  ).findIndex((k) => k === 'column');
  expect(colIdx).toBeGreaterThanOrEqual(0);
  const last = spanInput(page, colIdx + 1, 'Last');
  const was = Number(await last.inputValue());
  expect(was).toBe(3); // "everything" covers all three rows
  await last.fill('2');
  await expect(stateLine(page)).toHaveText(
    'Proposal applied, with your changes. Will be saved as: Grid',
  );
  expect(await rowSpans(previewTables(page))).not.toEqual(spans);
  await expect(page.getByRole('button', { name: 'Reset to proposal' })).toBeVisible();

  // Valid grid: saves as grid.
  await last.fill(String(was));
  await save(page).click();
  await expectSavedGrid(page, 'Fixture Vague Batter');
  await expect(page.locator('table.rg-table')).toHaveCount(1);
});

test('medium confidence saved untouched stays a list', async () => {
  const job = await apiImport(ctx, { url: url('medium') });
  await openReview(page, job.id);
  await save(page).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('table.rg-table')).toHaveCount(0);
});

test('low confidence: opens as list, only "Try the grid anyway" is offered, list save stays list', async () => {
  const job = await apiImport(ctx, { url: url('low') });
  expect(job.mapping_level).toBe('low');
  await openReview(page, job.id);
  await expect(panel(page).getByText('Could not map reliably')).toBeVisible();
  await expect(stateLine(page)).toHaveText('Will be saved as: List');
  await expect(page.getByRole('button', { name: 'Preview as grid' })).toHaveCount(0);
  // Secondary control sits after the reasons (DOM order = reading order).
  const reasons = panel(page).getByText('Match score: 0.00 out of 1');
  const tryBtn = page.getByRole('button', { name: 'Try the grid anyway' });
  await expect(reasons).toBeVisible();
  const [yReasons, yTry] = [(await reasons.boundingBox())!.y, (await tryBtn.boundingBox())!.y];
  expect(yTry).toBeGreaterThan(yReasons);

  await tryBtn.click();
  await expect(panel(page).getByText('Grid preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use list view instead' })).toBeVisible();
  // Nothing saves as grid by accident: back to the list, then save.
  await page.getByRole('button', { name: 'Use list view instead' }).click();
  await expect(stateLine(page)).toHaveText('Showing the list as imported. Will be saved as: List');
  await expect(page.getByRole('button', { name: 'Try the grid anyway' })).toBeFocused();
  await save(page).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
});

test('invalid span: preview lists the validator messages, save is blocked, a server 422 shows the grid message', async () => {
  const job = await apiImport(ctx, { url: url('high') });
  await openReview(page, job.id);
  const before = await recipeCount();

  await spanInput(page, 3, 'Last').fill('99');
  await expect(previewTables(page)).toHaveCount(0);
  await expect(
    panel(page).getByText('The grid cannot be shown yet. Fix these', { exact: false }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole('link', { name: /Step 3: This row does not exist/ }),
  ).toBeVisible();
  await expect(stateLine(page)).toContainText('The grid cannot be shown yet.');

  // Client validation blocks the request and moves focus to the summary.
  let posted = 0;
  await page.route('**/api/import/*/save', async (route) => {
    posted++;
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        errors: [{ path: 'sections.0.steps.2.row_end', code: 'row_out_of_range' }],
      }),
    });
  });
  await save(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'need' })).toBeVisible();
  expect(posted).toBe(0);

  // Server says no for a grid the client thought valid: the panel says so too.
  await spanInput(page, 3, 'Last').fill('1');
  await expect(previewTables(page)).toHaveCount(1);
  await save(page).click();
  await expect.poll(() => posted).toBe(1);
  await expect(stateLine(page)).toContainText(
    'The grid is not valid; fix the steps or use the list view.',
  );
  await expect(page.getByRole('alert').filter({ hasText: 'need' })).toContainText(
    'This row does not exist',
  );
  await page.unroute('**/api/import/*/save');
  // Any edit clears the stale message.
  await spanInput(page, 3, 'Last').fill('1');
  await spanInput(page, 3, 'Last').fill('2');
  await expect(stateLine(page)).not.toContainText('The grid is not valid');
  expect(await recipeCount()).toBe(before);

  // The real server: a grid with a span out of range is a 422 and creates nothing.
  const bad = await ctx.request.post(`${SEAM}/api/import/${job.id}/save`, {
    headers: SEAM_ORIGIN,
    data: {
      title: 'Tampered',
      visibility: 'private',
      view_mode: 'grid',
      sections: [
        {
          title: null,
          ingredients: [{ name: 'flour', raw_text: 'flour' }],
          steps: [{ kind: 'column', label: 'mix', detail: 'Mix.', row_start: 0, row_end: 40 }],
        },
      ],
    },
  });
  expect(bad.status()).toBe(422);
  expect(JSON.stringify(await bad.json())).toContain('row_out_of_range');
  expect(await recipeCount()).toBe(before);
  const again = await ctx.request.get(`${SEAM}/api/import/${job.id}`);
  expect(((await again.json()) as { status: string }).status).toBe('needs_review');
});

test('"Use list view instead" and "Reset to proposal": confirm only when sections were edited', async () => {
  const job = await apiImport(ctx, { url: url('high') });
  await openReview(page, job.id);
  await page.getByLabel('Title', { exact: true }).fill('Kept title');

  // Untouched sections: no confirm, the list loads at once and the title edit survives.
  await page.getByRole('button', { name: 'Use list view instead' }).click();
  await expect(page.getByText('This replaces your changes')).toHaveCount(0);
  await expect(stateLine(page)).toHaveText('Showing the list as imported. Will be saved as: List');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Kept title');
  await expect(page.getByRole('button', { name: 'Preview as grid' })).toBeFocused();
  await expect(spanInput(page, 3, 'First')).toHaveValue('');

  // Apply again, edit a step detail (ingredients/steps edits count), then ask to go back.
  await page.getByRole('button', { name: 'Preview as grid' }).click();
  await expect(previewTables(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Use list view instead' })).toBeVisible();
  await spanInput(page, 4, 'Last').fill('3');
  await expect(page.getByRole('button', { name: 'Reset to proposal' })).toBeVisible();
  await page.getByRole('button', { name: 'Use list view instead' }).click();
  const group = page.getByRole('group', { name: /This replaces your changes/ });
  await expect(group).toBeVisible();
  await expect(group.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await expect(group.getByRole('button', { name: 'Replace' })).toBeVisible();

  // Esc cancels and focus returns to the control that asked.
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use list view instead' })).toBeFocused();
  await expect(spanInput(page, 4, 'Last')).toHaveValue('3'); // edit kept

  // Reset: confirm, Replace restores the proposal and keeps the title.
  await page.getByRole('button', { name: 'Reset to proposal' }).click();
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(stateLine(page)).toHaveText('Proposal restored. Will be saved as: Grid');
  await expect(spanInput(page, 4, 'Last')).toHaveValue('4');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Kept title');
  await expect(page.locator('#map-preview-summary')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Reset to proposal' })).toHaveCount(0);
});

test('preview <details> stays in sync with its state across edits and remounts', async () => {
  const job = await apiImport(ctx, { url: url('high') });
  await openReview(page, job.id);
  const details = panel(page).locator('details', { has: page.locator('#map-preview-summary') });
  await expect(details).toHaveAttribute('open', '');
  await page.locator('#map-preview-summary').click(); // close
  await expect(details).not.toHaveAttribute('open', '');
  await spanInput(page, 3, 'Last').fill('2'); // an edit must not reopen or reset it
  await expect(details).not.toHaveAttribute('open', '');
  await page.locator('#map-preview-summary').click(); // open again
  await expect(details).toHaveAttribute('open', '');
  await expect(previewTables(page)).toBeVisible();
  // Closed, then a remount (list and back): applying always shows the preview.
  await page.locator('#map-preview-summary').click();
  await page.getByRole('button', { name: 'Use list view instead' }).click(); // edited -> confirm
  await page.getByRole('button', { name: 'Replace' }).click();
  await page.getByRole('button', { name: 'Preview as grid' }).click();
  await expect(details).toHaveAttribute('open', '');
  await expect(previewTables(page)).toBeVisible();
});

test('sections: HowToSection recipe shows two parts in the preview and on the saved page', async () => {
  const job = await apiImport(ctx, { url: url('sections') });
  expect(job.mapping_level).toBe('high');
  await openReview(page, job.id);
  await expect(previewTables(page)).toHaveCount(2);
  await expect(panel(page).getByRole('heading', { name: 'Cake' })).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Frosting' })).toBeVisible();
  await save(page).click();
  await expectSavedGrid(page, 'Two-part Sponge');
  await expect(page.locator('table.rg-table')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Cake' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Frosting' })).toBeVisible();
});

test('paste: plain text with a "For the sauce:" heading maps to two sections', async () => {
  const job = await apiImport(ctx, { text: PASTE_TEXT });
  await openReview(page, job.id);
  await expect(panel(page)).toBeVisible();
  if (job.mapping_level !== 'high')
    await page.getByRole('button', { name: 'Preview as grid' }).click();
  await expect(previewTables(page)).toHaveCount(2);
  await expect(panel(page).getByRole('heading', { name: 'Sauce' })).toBeVisible();
  await expect(page.getByLabel('Section 2 title', { exact: false })).toHaveValue('Sauce');
});

test('tampered draft rows: bad mapping is ignored, out-of-range spans are caught, nothing crashes', async () => {
  const cap = captureConsole(page);
  const before = await recipeCount();

  // 1. Unknown level / version: the proposal is dropped and the screen behaves like v0.3.0.
  const a = await apiImport(ctx, { url: url('high') });
  tamperDraft(a.id, (d) => {
    (d['mapping'] as { level: string }).level = 'excellent';
  });
  await openReview(page, a.id);
  await expect(page.getByRole('region', { name: 'Automatic grid' })).toHaveCount(0);
  await expect(page.getByLabel('Ingredients').first()).toBeVisible();
  await save(page).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');

  // 2. Valid-looking mapping whose spans point past the ingredients.
  const b = await apiImport(ctx, { url: url('high') });
  tamperDraft(b.id, (d) => {
    const m = d['mapping'] as { sections: { steps: { kind: string; row_end: number | null }[] }[] };
    for (const s of m.sections[0].steps) if (s.kind === 'column') s.row_end = 400;
  });
  await openReview(page, b.id);
  await expect(panel(page)).toBeVisible();
  await expect(previewTables(page)).toHaveCount(0);
  await expect(
    panel(page).getByText('The grid cannot be shown yet.', { exact: false }).first(),
  ).toBeVisible();
  await save(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'need' })).toBeVisible();
  await expect(page).toHaveURL(/\/import\/[0-9A-Z]{26}$/);
  // The list view is still a way out.
  await page.getByRole('button', { name: 'Use list view instead' }).click();
  await expect(stateLine(page)).toContainText('Will be saved as: List');

  // 3. A mapping whose sections are not sections at all must not crash the page.
  const c = await apiImport(ctx, { url: url('high') });
  tamperDraft(c.id, (d) => {
    (d['mapping'] as { sections: unknown }).sections = [{ foo: 'bar' }];
  });
  const res = await page.goto(`${SEAM}/import/${c.id}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Review the imported recipe' })).toBeVisible();
  expect(cap.all().filter((m) => m.startsWith('pageerror'))).toEqual([]);
  expect(await recipeCount()).toBe(before + 1); // only the list save of case 1
});

test('no hydration warning on the review screen (with and without mapping), /recipes/new and the edit form', async () => {
  const cap = captureConsole(page);
  const withMapping = await apiImport(ctx, { url: url('high') });
  const plain = await apiImport(ctx, { url: url('medium') });
  tamperDraft(plain.id, (d) => {
    d['mapping'] = null;
  });

  for (const job of [withMapping, plain]) {
    await openReview(page, job.id);
    await page.reload(); // SSR HTML + hydration again, with the listener attached from the start
    await hydrated(page.getByLabel('Title', { exact: true }));
  }
  await page.goto(`${SEAM}/recipes/new`);
  await hydrated(page.getByLabel('Title', { exact: true }));

  // Edit form of an existing grid recipe (the one saved by the first test).
  const list = (await (await ctx.request.get('/api/recipes')).json()) as {
    recipes: { id: string; title: string }[];
  };
  const grid = list.recipes.find((r) => r.title === 'Fixture Skillet Cookie')!;
  await page.goto(`${SEAM}/recipes/${grid.id}/edit`);
  await hydrated(page.getByLabel('Title', { exact: true }));

  expect(cap.hydrationMessages()).toEqual([]);
  expect(cap.all().filter((m) => m.startsWith('pageerror'))).toEqual([]);

  // The capture itself works: a message shaped like React's is picked up.
  await page.evaluate(() => console.error('Hydration failed because the server rendered HTML'));
  await expect.poll(() => cap.hydrationMessages().length).toBe(1);
});
