import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { account, createRecipe, registerViaInvite, signIn } from './helpers';
import {
  COOKIE_BANNERS_TOP,
  COOKIE_COLUMNS,
  cookieStart,
  fetchRecipe,
  openRecipe,
  project,
} from './grid-editor-support';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';

// T10 (3): recreate the Mocha Skillet Cookie at 375 x 667 with touch taps, spans set only
// through the bottom sheet's Start / End steppers (no drag, no handles at this width).
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gephone');
let owner: BrowserContext;
let recipeId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  owner = await browser.newContext();
  await signIn(await owner.newPage(), me);
  recipeId = await createRecipe(owner, cookieStart(9, 'Phone cookie'));
});
test.afterAll(async () => owner?.close());

const sheet = (page: Page) => page.getByRole('dialog');

/** Current 1-based row shown by the Start or End stepper of the sheet. */
async function rowOf(group: Locator) {
  const m = /Row (\d+) of/.exec(await group.locator('.ge-steppervalue').innerText());
  return Number(m![1]);
}

async function setSpan(page: Page, start: number, end: number) {
  const s = sheet(page);
  const g = (name: string) => s.getByRole('group', { name, exact: true });
  for (let guard = 0; guard < 12 && (await rowOf(g('Start row'))) !== start + 1; guard++) {
    const cur = await rowOf(g('Start row'));
    await s
      .getByRole('button', {
        name: cur > start + 1 ? /start one row earlier/ : /start one row later/,
      })
      .tap();
    await expect.poll(() => rowOf(g('Start row'))).toBe(cur + (cur > start + 1 ? -1 : 1));
  }
  for (let guard = 0; guard < 12 && (await rowOf(g('End row'))) !== end + 1; guard++) {
    const cur = await rowOf(g('End row'));
    await s
      .getByRole('button', { name: cur > end + 1 ? /end one row earlier/ : /end one row later/ })
      .tap();
    await expect.poll(() => rowOf(g('End row'))).toBe(cur + (cur > end + 1 ? -1 : 1));
  }
  expect(await rowOf(g('Start row'))).toBe(start + 1);
  expect(await rowOf(g('End row'))).toBe(end + 1);
}

async function fillSheet(
  page: Page,
  s: {
    label: string;
    detail: string;
    temp_c?: number | null;
    temp_f?: number | null;
    minutes_min?: number | null;
    minutes_max?: number | null;
  },
) {
  const d = sheet(page);
  const fields = d.getByText('Step details (label, text, time)');
  if ((await d.locator('details[open]').count()) === 0) await fields.tap();
  await d.getByRole('textbox', { name: 'Label', exact: true }).fill(s.label);
  await d.getByRole('textbox', { name: 'Detail', exact: true }).fill(s.detail);
  const num = async (name: string, v: number | null | undefined) => {
    if (v != null) await d.getByRole('spinbutton', { name }).fill(String(v));
  };
  await num('Temperature (°C)', s.temp_c);
  await num('Temperature (°F)', s.temp_f);
  await num('Time, from (minutes)', s.minutes_min);
  await num('Time, to (minutes)', s.minutes_max);
}

const closeSheet = async (page: Page) => {
  await sheet(page).getByRole('button', { name: 'Close' }).tap();
  await expect(sheet(page)).toBeHidden();
};

test('phone 375 x 667: recreate the sample through the bottom sheet only', async ({ browser }) => {
  const { page, ctx } = await openRecipe(browser, owner, recipeId, {
    width: 375,
    height: 667,
    touch: true,
  });
  await page.getByRole('button', { name: 'Edit grid' }).tap();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
  // No pointer handles exist on a phone (spans come from the sheet).
  await expect(page.locator('[role="slider"]:visible')).toHaveCount(0);

  const [melt, mix1, mix2, fold, bake] = COOKIE_COLUMNS;
  await page.locator('[data-ge-target^="step:"]').first().tap();
  await expect(sheet(page)).toBeVisible();
  await setSpan(page, 0, 0);
  await fillSheet(page, melt);
  await closeSheet(page);

  for (const s of [mix1, mix2, fold, bake]) {
    await page.getByRole('button', { name: 'Add step', exact: true }).tap();
    await expect(sheet(page)).toBeVisible();
    // F4: a new step opens the details and focuses the label (text selected).
    await expect(sheet(page).locator('details[open]')).toHaveCount(1);
    await expect(sheet(page).getByRole('textbox', { name: 'Label', exact: true })).toBeFocused();
    await setSpan(page, s.row_start!, s.row_end!);
    await fillSheet(page, s);
    await closeSheet(page);
  }
  for (const b of COOKIE_BANNERS_TOP) {
    await page.getByRole('button', { name: 'Add top banner' }).tap();
    await expect(sheet(page)).toBeVisible();
    await fillSheet(page, b);
    await closeSheet(page);
  }

  await page.getByRole('button', { name: /^Save changes/ }).tap();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.getByRole('button', { name: 'Edit grid' })).toBeVisible();
  await ctx.close();

  const stored = await fetchRecipe(owner, recipeId);
  expect(project(stored)).toEqual(project(SAMPLE_SKILLET_COOKIES));
  expect(stored.view_mode).toBe('grid');
});
