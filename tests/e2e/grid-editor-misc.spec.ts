import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  account,
  createRecipe,
  hydrated,
  ORIGIN,
  registerViaInvite,
  SAMPLES,
  signIn,
  scrollSettled,
} from './helpers';
import {
  cookieStart,
  fetchRecipe,
  openRecipe,
  rowTargets,
  saveButton,
} from './grid-editor-support';
import type { RecipeInput } from '@/lib/recipes/schemas';

// T10 (4) two-section cake, undo/redo and the leave guard; (5) permissions and conflict;
// (6) XSS strings; (7) the O4 check (Alt+Left / Alt+Right must not navigate history).
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 5000 });

const me = account('gemisc');
const other = account('gemember');
let owner: BrowserContext;
let member: BrowserContext;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  await registerViaInvite(browser, other);
  owner = await browser.newContext();
  await signIn(await owner.newPage(), me);
  member = await browser.newContext();
  await signIn(await member.newPage(), other);
});
test.afterAll(async () => {
  await owner?.close();
  await member?.close();
});

/** Cake section only, sugar as ONE row, so the editor has to add a section and split sugar. */
function cakeStart(title: string, visibility: 'private' | 'users' = 'private'): RecipeInput {
  const cake = SAMPLES.cake.sections[0];
  const ingredients = cake.ingredients.filter((i) => i.portion_label !== 'remaining');
  ingredients[1] = { ...ingredients[1], split_group_id: null, portion_label: null };
  return {
    ...SAMPLES.cake,
    title,
    visibility,
    sections: [
      {
        title: 'Cake',
        ingredients,
        steps: [
          cake.steps[0],
          {
            kind: 'column',
            label: 'cream',
            detail: 'Beat the butter and sugar.',
            row_start: 0,
            row_end: 1,
          },
          {
            kind: 'column',
            label: 'bake',
            detail: 'Bake it.',
            row_start: 0,
            row_end: ingredients.length - 1,
          },
        ],
      },
    ],
  };
}

const edit = async (page: Page) => {
  await page.getByRole('button', { name: 'Edit grid' }).click();
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeFocused();
};

test('two sections: add and rename a section, split sugar, undo/redo, leave guard, save, read view', async ({
  browser,
}) => {
  const id = await createRecipe(owner, cakeStart('Two section cake'));
  const { page, ctx } = await openRecipe(browser, owner, id, { width: 1280, height: 1500 });
  await edit(page);
  const headings = page.locator('[data-ge-heading]');
  await expect(headings).toHaveCount(1);

  // Add section, rename it, give it a row and a step.
  await page.getByRole('button', { name: 'Add section' }).click();
  await expect(headings).toHaveCount(2);
  // F5: the new section asks for its name at once (empty field, hint placeholder), and no
  // literal "Section 2" title is stored.
  const nameField = page.getByRole('textbox', { name: 'Section name' });
  await expect(nameField).toBeFocused();
  await expect(nameField).toHaveAttribute('placeholder', 'Name this part, for example Frosting');
  await nameField.fill('Frosting');
  await page.keyboard.press('Enter');
  await expect(headings.nth(1)).toHaveText('Frosting');
  await page.locator('[data-ge-addrow]').nth(1).click();
  await page
    .getByRole('textbox', { name: 'Edit ingredient 1' })
    .fill('2 cups (240 g) powdered sugar');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add step', exact: true }).nth(1).click();
  await page.getByRole('textbox', { name: 'Label', exact: true }).fill('whip');
  await page.getByRole('textbox', { name: 'Detail', exact: true }).fill('Whip until fluffy.');

  // Split sugar (row 2 of the cake).
  const cakeRows = page.locator('[data-ge-table]').first().locator('[data-ge-target^="row:"]');
  const before = await cakeRows.count();
  const sugarActions = page.getByRole('button', { name: /^Row actions for .*sugar/ }).first();
  await scrollSettled(sugarActions);
  await sugarActions.click();
  // dispatchEvent: Playwright's auto-scroll before a real click scrolls the page, and a scroll
  // closes the Row actions menu (by design); the item is visible, so no scrolling is needed.
  await page.getByRole('menuitem', { name: 'Split into portions' }).dispatchEvent('click');
  await page.getByRole('textbox', { name: /^Portion label for/ }).fill('second half');
  await page.keyboard.press('Enter');
  await expect(cakeRows).toHaveCount(before + 1);

  // Undo / redo through the session: the whole sequence comes back identical.
  const snapshot = async () => ({
    rows: await rowTargets(page).allInnerTexts(),
    headings: await headings.allInnerTexts(),
    steps: await page.locator('[data-ge-target^="step:"]').allInnerTexts(),
  });
  const full = await snapshot();
  await cakeRows.first().focus();
  const undo = page.getByRole('button', { name: /^Undo/ });
  let undone = 0;
  while (
    (await undo.getAttribute('aria-disabled')) !== 'true' &&
    !(await undo.isDisabled()) &&
    undone < 30
  ) {
    await page.keyboard.press('Control+z');
    undone++;
    await cakeRows.first().focus();
  }
  expect(undone).toBeGreaterThan(3);
  await expect(headings).toHaveCount(1);
  await expect(page.getByText('All changes saved').or(page.getByText('No changes'))).toHaveCount(
    (await page.getByText('Unsaved changes').count()) ? 0 : 1,
  );
  for (let i = 0; i < undone; i++) {
    await page.keyboard.press('Control+Shift+z');
    await cakeRows.first().focus();
  }
  expect(await snapshot()).toEqual(full);

  // Leave guard: a reload with unsaved changes raises beforeunload; dismissing keeps the editor.
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  void page.reload().catch(() => undefined);
  await expect.poll(() => dialogs).toEqual(['beforeunload']);
  await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await saveButton(page).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Read view: two sections, the split rows with their portion labels.
  await expect(page.getByRole('heading', { name: 'Frosting' })).toBeVisible();
  await expect(page.getByText('second half').first()).toBeVisible();
  await expect(page.getByText('powdered sugar').first()).toBeVisible();
  const stored = await fetchRecipe(owner, id);
  expect(stored.sections.map((s) => s.title)).toEqual(['Cake', 'Frosting']);
  const sugars = stored.sections[0].ingredients.filter((i) => i.name === 'sugar');
  expect(sugars).toHaveLength(2);
  expect(sugars[0].split_group_id).toBeTruthy();
  expect(sugars[0].split_group_id).toBe(sugars[1].split_group_id);
  expect(sugars.map((s) => s.portion_label)).toContain('second half');
  expect(stored.sections[1].steps.map((s) => s.label)).toEqual(['whip']);
  await ctx.close();
});

test('permissions: a member without write sees no Edit grid; PUT /grid is 403 or 404', async ({
  browser,
}) => {
  const shared = await createRecipe(owner, cakeStart('Shared cake', 'users'));
  const hidden = await createRecipe(owner, cakeStart('Hidden cake', 'private'));
  const stored = await fetchRecipe(owner, shared);

  const page = await member.newPage();
  await page.goto(`/recipes/${shared}`);
  await expect(page.getByRole('heading', { name: 'Shared cake' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit grid' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Edit$/ })).toHaveCount(0);
  await page.goto(`/recipes/${hidden}`);
  await expect(page.getByRole('button', { name: 'Edit grid' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hidden cake' })).toHaveCount(0);
  await page.close();

  const body = { base_updated_at: stored.updated_at, sections: cakeStart('x').sections };
  const put = (c: BrowserContext, rid: string, headers: Record<string, string> = ORIGIN) =>
    c.request.put(`/api/recipes/${rid}/grid`, { headers, data: body });
  expect((await put(member, shared)).status()).toBe(403);
  expect((await put(member, hidden)).status()).toBe(404);
  expect((await put(member, 'does-not-exist')).status()).toBe(404);
  expect((await put(member, shared, {})).status()).toBe(403); // CSRF check comes first
  const anon = await browser.newContext();
  expect((await put(anon, shared)).status()).toBe(401);
  await anon.close();
  // Nothing changed, and the owner can still save (the control that the body itself is valid).
  expect((await fetchRecipe(owner, shared)).updated_at).toBe(stored.updated_at);
  expect((await put(owner, shared)).status()).toBe(200);
  // A 'users' recipe is listed for every account; remove it so other specs (recipes.spec's empty
  // state) never see it.
  expect((await owner.request.delete(`/api/recipes/${shared}`, { headers: ORIGIN })).status()).toBe(
    204,
  );
});

test('conflict: the second saver gets the panel; Load latest keeps the first writer', async ({
  browser,
}) => {
  const id = await createRecipe(owner, cookieStart(9, 'Conflict cookie'));
  const a = await openRecipe(browser, owner, id, { width: 1280, height: 1200 });
  const b = await openRecipe(browser, owner, id, { width: 1280, height: 1200 });
  await edit(a.page);
  await edit(b.page);
  const rename = async (p: Page, text: string) => {
    await rowTargets(p).first().focus();
    await p.keyboard.press('F2');
    await p.getByRole('textbox', { name: 'Edit ingredient 1' }).fill(text);
    await p.keyboard.press('Enter');
  };
  await rename(a.page, '9 oz writer a butter');
  await saveButton(a.page).click();
  await expect(a.page.getByText('All changes saved')).toBeVisible();
  const afterA = await fetchRecipe(owner, id);

  await rename(b.page, '1 oz writer b butter');
  await saveButton(b.page).click();
  await expect(
    b.page.getByRole('heading', { name: 'This recipe changed while you were editing.' }),
  ).toBeFocused();
  expect(await fetchRecipe(owner, id)).toEqual(afterA); // nothing of b was stored
  await b.page.getByRole('button', { name: 'Load the latest version' }).click();
  await b.page.getByRole('button', { name: 'Discard and load' }).click();
  await expect(rowTargets(b.page).first()).toContainText('writer a butter');
  await a.ctx.close();
  await b.ctx.close();
});

test('XSS strings in names, labels and section titles round-trip as text', async ({ browser }) => {
  const id = await createRecipe(owner, cakeStart('XSS cake'));
  const strings = {
    // No parentheses: the ingredient parser would move "(1)" into the note.
    ing: '<img src=x onerror=window.__pwn=1>',
    step: '<script>alert(2)</script>',
    section: '"><svg onload=alert(3)>',
    banner: '<b>not bold</b>',
  };
  const { page, ctx } = await openRecipe(browser, owner, id, { width: 1280, height: 1500 });
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await edit(page);
  await rowTargets(page).first().focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Edit ingredient 1' }).fill(strings.ing);
  await page.keyboard.press('Enter');
  await page.locator('[data-ge-target^="step:"]').nth(1).click();
  await page.getByRole('textbox', { name: 'Label', exact: true }).fill(strings.step);
  await page.getByRole('button', { name: 'Rename' }).first().click();
  await page.getByRole('textbox', { name: 'Section name' }).fill(strings.section);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add top banner' }).click();
  await page.getByRole('textbox', { name: 'Detail', exact: true }).fill(strings.banner);
  await page.getByRole('textbox', { name: 'Label', exact: true }).fill(strings.banner);

  const noInjection = async () => {
    await expect(page.locator('img[src="x"], svg[onload], .ge-root b, main b')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn),
    ).toBeUndefined();
    expect(dialogs).toEqual([]);
  };
  await expect(page.getByText(strings.ing, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(strings.section).first()).toBeVisible();
  await noInjection();

  await saveButton(page).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const stored = await fetchRecipe(owner, id);
  expect(stored.sections[0].title).toBe(strings.section);
  expect(stored.sections[0].ingredients[0].name).toBe(strings.ing);
  expect(stored.sections[0].steps.map((s) => s.label)).toContain(strings.step);
  expect(stored.sections[0].steps.map((s) => s.label)).toContain(strings.banner);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(strings.ing).first()).toBeVisible();
  await expect(page.getByText(strings.section).first()).toBeVisible();
  await noInjection();
  await page.reload();
  await hydrated(page.getByRole('button', { name: 'Edit grid' }));
  await expect(page.getByText(strings.ing).first()).toBeVisible();
  await noInjection();
  await edit(page);
  await expect(page.getByText(strings.ing).first()).toBeVisible();
  await noInjection();
  await ctx.close();
});

test('O4: Alt+ArrowLeft / Alt+ArrowRight over a roving target are cancelled and do not navigate history', async ({
  browser,
}, testInfo) => {
  const id = await createRecipe(owner, cakeStart('History cake'));
  const { page, ctx } = await openRecipe(browser, owner, id, { width: 1280, height: 1200 });
  // History: /recipes/:id sits above another entry, so a Back would be visible.
  await page.goto('/');
  await page.goto(`/recipes/${id}`);
  await hydrated(page.getByRole('button', { name: 'Edit grid' }));
  await edit(page);
  const here = page.url();

  // What the page controls: the keydown of the chord is cancelled over every roving target (a
  // cancelled keydown is what stops Chrome's Back accelerator) and is NOT cancelled elsewhere.
  const cancelled = (target: ReturnType<Page['locator']>, key: string) =>
    target.evaluate((el, k) => {
      const e = new KeyboardEvent('keydown', {
        key: k,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    }, key);
  const probe = async (target: ReturnType<Page['locator']>) => {
    for (const key of ['ArrowLeft', 'ArrowRight'])
      expect(await cancelled(target, key), `${key} keydown cancelled`).toBe(true);
    await target.focus();
    for (const key of ['Alt+ArrowLeft', 'Alt+ArrowRight']) {
      await page.keyboard.press(key);
      await page.waitForLoadState('load');
      expect(page.url(), `${key} on ${await target.getAttribute('data-ge-target')}`).toBe(here);
      await expect(page.getByRole('heading', { name: 'Grid editor' })).toBeVisible();
    }
  };
  await probe(rowTargets(page).first());
  await probe(page.locator('[data-ge-target^="step:"]').first());
  await probe(page.locator('[data-ge-target^="banner:"]').first());

  expect(await cancelled(page.getByRole('heading', { name: 'Grid editor' }), 'ArrowLeft')).toBe(
    false,
  );

  // Negative control: the same chord on a plain heading. If this navigates, the harness really
  // delivers the browser history shortcut and the checks above are meaningful.
  await page.getByRole('heading', { name: 'Grid editor' }).click();
  await page.keyboard.press('Alt+ArrowLeft');
  const navigated = await page
    .waitForURL((u) => u.toString() !== here, { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  testInfo.annotations.push({
    type: 'O4 negative control',
    description: navigated
      ? 'Alt+Left on a non-handled element DID go back: chord swallowing is verified in Chromium.'
      : 'Alt+Left on a non-handled element did NOT go back: this Chromium build does not deliver the history accelerator to page key events, so the probe above cannot fail.',
  });
  console.log(`O4 negative control navigated: ${navigated}`);
  await ctx.close();
});
