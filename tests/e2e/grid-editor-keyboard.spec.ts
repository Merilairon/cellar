import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
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
} from './grid-editor-support';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';

// T10 (2): recreate the Mocha Skillet Cookie with the KEYBOARD only (UX spec 14.4 trace).
// Allowed: Tab / Shift+Tab, arrows, Enter, Escape, the chords of spec 14.3, typed text.
// Forbidden: any pointer call. The first test reads this file and fails if one is present.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gekeys');
let owner: BrowserContext;
let recipeId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  owner = await browser.newContext();
  await signIn(await owner.newPage(), me);
  recipeId = await createRecipe(owner, cookieStart(8, 'Keyboard cookie'));
});
test.afterAll(async () => owner?.close());

test('this spec never uses a pointer', () => {
  const src = readFileSync(__filename, 'utf8');
  const body = src.slice(src.lastIndexOf('// ----' + ' body'));
  const banned = [
    'page.' + 'mouse',
    '.click' + '(',
    '.dblclick' + '(',
    '.tap' + '(',
    '.hover' + '(',
    '.dragTo' + '(',
    '.fill' + '(',
    '.check' + '(',
    '.focus' + '(',
    '.selectOption' + '(',
  ];
  for (const w of banned) expect(body.includes(w), w).toBe(false);
});

// ---- body

/**
 * Presses Tab (or Shift+Tab, chosen from document order) until `target` has focus. Real tab
 * order only: the target must be a tab stop, which is part of what this test proves.
 */
async function reach(page: Page, target: Locator, max = 80) {
  const handle = await target.elementHandle({ timeout: 5000 });
  for (let i = 0; i < max; i++) {
    const where = await page.evaluate((t) => {
      const a = document.activeElement;
      if (a === t) return 0;
      if (!a || a === document.body) return 1;
      return a.compareDocumentPosition(t as Node) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
    }, handle);
    if (where === 0) return;
    await page.keyboard.press(where > 0 ? 'Tab' : 'Shift+Tab');
  }
  throw new Error(`could not reach ${target} with Tab in ${max} presses`);
}

async function typeInto(page: Page, field: Locator, text: string) {
  await reach(page, field);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text);
}

const label = (page: Page) => panel(page).getByRole('textbox', { name: 'Label', exact: true });
const detail = (page: Page) => panel(page).getByRole('textbox', { name: 'Detail', exact: true });
const rows = (page: Page) => page.locator('[data-ge-target^="row:"]');
/** The roving tab stop of the (single) section table. */
const tableStop = (page: Page) => page.locator('table.ge-table [data-ge-target][tabindex="0"]');

/** 1-based start/end rows of the step cell that has focus. */
const focusedSpan = (page: Page) =>
  page.evaluate(() => {
    const td = document.activeElement?.closest('td.ge-step');
    const v = (e: string) =>
      td?.querySelector(`[data-edge="${e}"]`)?.getAttribute('aria-valuenow') ?? null;
    return td ? `${v('start')}-${v('end')}` : null;
  });

/** Focus the step that covers 0-based row `r`: Ctrl+Home (first target), Down r times, Right. */
async function focusStepAtRow(page: Page, r: number) {
  await reach(page, tableStop(page));
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < r; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('td.ge-step button:focus')).toHaveCount(1);
}

async function chord(page: Page, key: string, times: number, edge: 'start' | 'end', from: number) {
  for (let i = 1; i <= times; i++) {
    await page.keyboard.press(key);
    // Alt+Up lowers the start by one; Shift+Down raises the end by one.
    const want = edge === 'start' ? from - i : from + i;
    await expect
      .poll(async () => (await focusedSpan(page))?.split('-')[edge === 'start' ? 0 : 1])
      .toBe(String(want));
  }
}

test('keyboard only: recreate the Mocha Skillet Cookie, save, compare with the sample', async ({
  browser,
}) => {
  const { page, ctx } = await openRecipe(browser, owner, recipeId, { width: 1280, height: 1700 });

  // 14.4 step 0: Tab to "Edit grid", Enter. Focus lands on the editor heading.
  await reach(page, page.getByRole('button', { name: 'Edit grid' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  await expect(rows(page)).toHaveCount(8);

  // Row 9: End (last row), F2 edit text, Ctrl+Enter commits and opens a row below, type, Enter.
  await reach(page, tableStop(page));
  await page.keyboard.press('End');
  await expect(rows(page).last()).toBeFocused();
  await page.keyboard.press('F2');
  await expect(page.getByRole('textbox', { name: 'Edit ingredient 8' })).toBeFocused();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('textbox', { name: 'Edit ingredient 9' })).toBeFocused();
  await page.keyboard.type(NINTH_ROW_TEXT);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(9);
  await expect(rows(page).last()).toBeFocused();

  // 14.4 step 1: Home, Right (the step over row 1), Enter opens the panel, type label + detail.
  const [melt, mix1, mix2, fold, bake] = COOKIE_COLUMNS;
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('td.ge-step button:focus')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('heading', { level: 4 })).toBeFocused();
  await typeInto(page, label(page), melt.label);
  await typeInto(page, detail(page), melt.detail);

  // 14.4 step 2: Add step (Enter), type, then chords. A new step starts on the first uncovered row.
  const addStep = async (s: (typeof COOKIE_COLUMNS)[number], startRow: number) => {
    await reach(page, page.getByRole('button', { name: 'Add step', exact: true }));
    await page.keyboard.press('Enter');
    await expect(label(page)).toBeFocused();
    await page.keyboard.type(s.label); // the default text is selected, typing replaces it
    await typeInto(page, detail(page), s.detail);
    if (s.temp_f != null) {
      await typeInto(
        page,
        panel(page).getByRole('spinbutton', { name: 'Temperature (°C)' }),
        String(s.temp_c),
      );
      await typeInto(
        page,
        panel(page).getByRole('spinbutton', { name: 'Temperature (°F)' }),
        String(s.temp_f),
      );
      await typeInto(
        page,
        panel(page).getByRole('spinbutton', { name: 'Time, from (minutes)' }),
        String(s.minutes_min),
      );
      await typeInto(
        page,
        panel(page).getByRole('spinbutton', { name: 'Time, to (minutes)' }),
        String(s.minutes_max),
      );
    }
    await focusStepAtRow(page, startRow);
    await expect(page.locator('td.ge-step button:focus .rg-lbl')).toHaveText(s.label);
    await chord(page, 'Alt+ArrowUp', startRow, 'start', startRow + 1);
    await chord(page, 'Shift+ArrowDown', s.row_end! - startRow, 'end', startRow + 1);
    await expect.poll(() => focusedSpan(page)).toBe(`${s.row_start! + 1}-${s.row_end! + 1}`);
  };
  await addStep(mix1, 1); // rows 1 -> 0..3
  await addStep(mix2, 4); // 4 -> 0..4
  await addStep(fold, 5); // 5 -> 0..8

  // Bake: a new step over every row already; only text and numbers to type.
  await reach(page, page.getByRole('button', { name: 'Add step', exact: true }));
  await page.keyboard.press('Enter');
  await page.keyboard.type(bake.label);
  await typeInto(page, detail(page), bake.detail);
  await typeInto(
    page,
    panel(page).getByRole('spinbutton', { name: 'Temperature (°C)' }),
    String(bake.temp_c),
  );
  await typeInto(
    page,
    panel(page).getByRole('spinbutton', { name: 'Temperature (°F)' }),
    String(bake.temp_f),
  );
  await typeInto(
    page,
    panel(page).getByRole('spinbutton', { name: 'Time, from (minutes)' }),
    String(bake.minutes_min),
  );
  await typeInto(
    page,
    panel(page).getByRole('spinbutton', { name: 'Time, to (minutes)' }),
    String(bake.minutes_max),
  );

  // 14.4 step 3: two top banners (Enter on the button, typed label and detail).
  for (const b of COOKIE_BANNERS_TOP) {
    await reach(page, page.getByRole('button', { name: 'Add top banner' }));
    await page.keyboard.press('Enter');
    await expect(label(page)).toBeFocused();
    await page.keyboard.type(b.label);
    await typeInto(page, detail(page), b.detail);
  }

  // Undo / redo from the keyboard: focus a table target (not a text field), Ctrl+Z then Ctrl+Shift+Z.
  await reach(page, tableStop(page));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');

  // 14.4 step 5: Ctrl+S saves, then Done by Tab + Enter.
  await page.keyboard.press('Control+s');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await reach(page, page.getByRole('button', { name: 'Done' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit grid' })).toBeVisible();
  await ctx.close();

  const stored = await fetchRecipe(owner, recipeId);
  expect(project(stored)).toEqual(project(SAMPLE_SKILLET_COOKIES));
  expect(stored.view_mode).toBe('grid');
});
