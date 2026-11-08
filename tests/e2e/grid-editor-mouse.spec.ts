import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, registerViaInvite, signIn } from './helpers';
import {
  COOKIE_BANNERS_TOP,
  COOKIE_COLUMNS,
  NINTH_ROW_TEXT,
  cookieStart,
  fetchRecipe,
  openRecipe,
  panel,
  project,
  saveButton,
} from './grid-editor-support';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import { sourceBody } from './source-body';

// T10 (1): recreate the Mocha Skillet Cookie with the MOUSE only. Start state per UX spec F1:
// nine-row grid minus the ninth row, one column step over row 1. Clicks, real pointer drags on
// the span handles, and typed text; no key press anywhere (the test reads its own source below).
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gemouse');
let owner: BrowserContext;
let recipeId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  owner = await browser.newContext();
  await signIn(await owner.newPage(), me);
  recipeId = await createRecipe(owner, cookieStart(8, 'Mouse cookie'));
});
test.afterAll(async () => owner?.close());

test('this spec never presses a key', () => {
  const src = readFileSync(__filename, 'utf8');
  const banned = ['keyboard' + '.press', '.press' + '(', 'keyboard' + '.down', 'keyboard' + '.up'];
  // Only the test source below the marker counts (this check names the words itself).
  const body = sourceBody(src);
  for (const w of banned) expect(body.includes(w), w).toBe(false);
});

// ---- body

/** Real pointer drag of a step edge to a row boundary (top of `row` for start, bottom for end). */
async function dragEdge(page: Page, edge: 'start' | 'end', row: number) {
  const handle = page.locator(`td.ge-step[data-selected="true"] [data-edge="${edge}"]`);
  // A new step may already sit on the target row (e.g. the last step starts on all rows).
  if ((await handle.getAttribute('aria-valuenow')) === String(row + 1)) return;
  const h = (await handle.boundingBox())!;
  const r = (await page.locator('tbody th.ge-ing').nth(row).boundingBox())!;
  const x = h.x + h.width / 2;
  const y0 = h.y + h.height / 2;
  const y1 = edge === 'start' ? r.y + 1 : r.y + r.height - 1;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, y0 + Math.sign(y1 - y0) * 6, { steps: 3 });
  await page.mouse.move(x, y1, { steps: 8 });
  await page.mouse.up();
}

async function fillPanel(
  page: Page,
  s: {
    label?: string;
    detail?: string;
    temp_c?: number | null;
    temp_f?: number | null;
    minutes_min?: number | null;
    minutes_max?: number | null;
  },
) {
  const p = panel(page);
  if (s.label !== undefined)
    await p.getByRole('textbox', { name: 'Label', exact: true }).fill(s.label);
  if (s.detail !== undefined)
    await p.getByRole('textbox', { name: 'Detail', exact: true }).fill(s.detail);
  const num = async (name: string, v: number | null | undefined) => {
    if (v != null) await p.getByRole('spinbutton', { name }).fill(String(v));
  };
  await num('Temperature (°C)', s.temp_c);
  await num('Temperature (°F)', s.temp_f);
  await num('Time, from (minutes)', s.minutes_min);
  await num('Time, to (minutes)', s.minutes_max);
}

test('mouse only: recreate the Mocha Skillet Cookie, save, reload, compare with the sample', async ({
  browser,
}) => {
  const { page, ctx } = await openRecipe(browser, owner, recipeId, { width: 1280, height: 1700 });
  await page.getByRole('button', { name: 'Edit grid' }).click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  const rows = page.locator('[data-ge-target^="row:"]');
  await expect(rows).toHaveCount(8);

  // Row 9: Row actions > Add row below, type, click away to commit.
  await page
    .getByRole('button', { name: /^Row actions for/ })
    .last()
    .click();
  await page.getByRole('menuitem', { name: 'Add row below' }).click();
  await page.getByRole('textbox', { name: 'Edit ingredient 9' }).fill(NINTH_ROW_TEXT);
  await page.getByRole('heading', { name: 'Grid editor' }).click();
  await expect(rows).toHaveCount(9);
  await expect(rows.last()).toContainText('dark chocolate chunks');

  // Step 1 becomes "melt" (row 1 only, already right).
  const [melt, mix1, mix2, fold, bake] = COOKIE_COLUMNS;
  await page.locator('[data-ge-target^="step:"]').first().click();
  await fillPanel(page, { label: melt.label, detail: melt.detail });

  // Each added step starts on the first uncovered row; drag both handles to the target span.
  const addStep = async (s: (typeof COOKIE_COLUMNS)[number]) => {
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(panel(page).getByRole('textbox', { name: 'Label', exact: true })).toBeFocused();
    await fillPanel(page, s);
    // Start first (up to the section top), then the end edge down to its row.
    await dragEdge(page, 'start', s.row_start!);
    await dragEdge(page, 'end', s.row_end!);
    const sel = 'td.ge-step[data-selected="true"] [role="slider"]';
    await expect(page.locator(`${sel}[data-edge="start"]`)).toHaveAttribute(
      'aria-valuenow',
      String(s.row_start! + 1),
    );
    await expect(page.locator(`${sel}[data-edge="end"]`)).toHaveAttribute(
      'aria-valuenow',
      String(s.row_end! + 1),
    );
  };
  await addStep(mix1);
  await addStep(mix2);
  await addStep(fold);
  await addStep(bake);

  // Two top banners.
  for (const b of COOKIE_BANNERS_TOP) {
    await page.getByRole('button', { name: 'Add top banner' }).click();
    await expect(panel(page).getByRole('textbox', { name: 'Label', exact: true })).toBeFocused();
    await fillPanel(page, b);
  }

  // Undo is a button too: one undo then redo leaves the same grid (multi-step session).
  await page.getByRole('button', { name: /^Undo/ }).click();
  await page.getByRole('button', { name: /^Redo/ }).click();

  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await ctx.close();

  // Stored structure equals the sample: spans, banners, order, labels, details, times, split groups.
  const stored = await fetchRecipe(owner, recipeId);
  const expected = project(SAMPLE_SKILLET_COOKIES);
  const actual = project(stored);
  expect(actual[0].steps).toEqual(expected[0].steps);
  expect(actual[0].ingredients.map((i) => i.name)).toEqual(
    expected[0].ingredients.map((i) => i.name),
  );
  expect(actual).toEqual(expected);
  expect(stored.view_mode).toBe('grid');
});
