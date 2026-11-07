import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, hydrated, registerViaInvite, SAMPLES, signIn } from './helpers';

// T12 tag field: add (Enter / comma), autocomplete, remove, limit error, persistence on the
// recipe page and card, chips linking back to the filtered list, and tags on the import review.
test.describe.configure({ mode: 'serial' });

const me = account('tara');
let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await signIn(page, me);
  // Existing tags for the autocomplete to suggest (created through the API).
  await createRecipe(ctx, { ...SAMPLES.cake, title: 'Seed Cake', tags: ['vegetarian', 'vegan'] });
});
test.afterAll(async () => ctx?.close());

const tagInput = (p: Page) => p.getByRole('combobox', { name: 'Tags' });
const chipList = (p: Page) => p.getByRole('list', { name: 'Tags on this recipe' });
const removeBtn = (p: Page, name: string) => p.getByRole('button', { name: `Remove tag ${name}` });

async function startForm(p: Page, title: string) {
  await p.goto('/recipes/new');
  await hydrated(p.getByLabel('Title', { exact: true }));
  await p.getByLabel('Title', { exact: true }).fill(title);
  await p.getByLabel('Ingredients').fill('2 cups flour\n1 cup sugar\n3 eggs');
}

test('add by Enter and comma, collapse duplicates, remove, then save and reload', async () => {
  await startForm(page, 'Tagged Pancakes');
  const input = tagInput(page);

  await input.fill('Quick');
  await input.press('Enter'); // must add the tag, not submit the form
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(chipList(page).getByText('quick', { exact: true })).toBeVisible();

  await input.pressSequentially('weeknight,');
  await expect(chipList(page).getByText('weeknight', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');

  // Case/space variants of an existing tag collapse into it.
  await input.fill('  QUICK ');
  await input.press('Enter');
  await expect(chipList(page).getByRole('listitem')).toHaveCount(2);

  await input.fill('to remove');
  await input.press('Enter');
  await expect(chipList(page).getByRole('listitem')).toHaveCount(3);
  await removeBtn(page, 'to remove').click();
  await expect(chipList(page).getByRole('listitem')).toHaveCount(2);
  await expect(input).toBeFocused();

  // Backspace on an empty field removes the last chip.
  await input.fill('last');
  await input.press('Enter');
  await input.press('Backspace');
  await expect(chipList(page).getByText('last', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);

  // Recipe page: tags as chips that link to the filtered list.
  const tags = page.getByRole('list', { name: 'Tags', exact: true });
  await expect(tags.getByRole('link')).toHaveText(['quick', 'weeknight']);
  await expect(tags.getByRole('link', { name: 'quick' })).toHaveAttribute(
    'href',
    '/recipes?tag=quick',
  );
  await page.reload();
  await expect(tags.getByRole('link')).toHaveText(['quick', 'weeknight']);

  // The chip leads to the list filtered by that tag; the card shows the tags too.
  await tags.getByRole('link', { name: 'weeknight' }).click();
  await expect(page).toHaveURL(/\/recipes\?tag=weeknight$/);
  const cardEl = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'Tagged Pancakes' });
  await expect(cardEl).toHaveCount(1);
  await expect(cardEl.getByRole('list', { name: 'Tags on this recipe' })).toContainText('quick');
  await expect(cardEl.getByRole('list', { name: 'Tags on this recipe' })).toContainText(
    'weeknight',
  );
  await expect(page.getByRole('main').getByRole('heading', { name: 'Seed Cake' })).toHaveCount(0);
});

test('autocomplete suggests existing tags; arrow keys and Enter pick one', async () => {
  await startForm(page, 'Autocomplete Soup');
  const input = tagInput(page);
  await input.pressSequentially('veg');

  const list = page.getByRole('listbox', { name: 'Tag suggestions' });
  await expect(list).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByRole('option')).toHaveText(['vegan', 'vegetarian']);

  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(list.getByRole('option', { name: 'vegetarian' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('Enter');
  await expect(chipList(page).getByText('vegetarian', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(list).toBeHidden();

  // Escape closes the list without clearing the text; a mouse click on an option adds it.
  await input.pressSequentially('veg');
  await expect(list.getByRole('option')).toHaveText(['vegan']); // chosen tags are not offered again
  await input.press('Escape');
  await expect(list).toBeHidden();
  await expect(input).toHaveValue('veg');
  await input.fill('vega');
  await list.getByRole('option', { name: 'vegan' }).click();
  await expect(chipList(page).getByText('vegan', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  await expect(page.getByRole('list', { name: 'Tags', exact: true }).getByRole('link')).toHaveText([
    'vegan',
    'vegetarian',
  ]);
});

test('the 21st tag shows the limit error and is not added', async () => {
  await startForm(page, 'Too Many Tags');
  const input = tagInput(page);
  const names = Array.from({ length: 20 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
  await input.fill(names.join(', ') + ',');
  await expect(chipList(page).getByRole('listitem')).toHaveCount(20);
  await expect(page.getByText('20 of 20 tags')).toBeVisible();

  await input.fill('one-too-many');
  await input.press('Enter');
  await expect(page.locator('p', { hasText: 'A recipe can have at most 20 tags.' })).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(chipList(page).getByRole('listitem')).toHaveCount(20);
});

test('import review: keywords become removable chips, removed ones are not saved, the rest is findable', async () => {
  const html = `<!doctype html><html><head><title>Imported Tagged Stew</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Imported Tagged Stew',
    recipeCategory: 'Dinner',
    keywords: 'stewpot, hearty',
    recipeYield: '4 servings',
    recipeIngredient: ['2 cups flour', '1 cup sugar', '3 eggs'],
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'Mix the flour and the sugar.' },
      { '@type': 'HowToStep', text: 'Bake until golden.' },
    ],
  })}</script></head><body><h1>Imported Tagged Stew</h1></body></html>`;

  await page.goto('/import');
  await hydrated(page.getByLabel('Recipe web address'));
  await page.getByRole('tab', { name: 'Paste the recipe' }).click();
  await page.getByLabel('Recipe text or page source').fill(html);
  await page.getByRole('button', { name: 'Import recipe' }).click();

  await expect(page.getByRole('heading', { name: 'Review the imported recipe' })).toBeVisible();
  await expect(chipList(page).getByRole('listitem')).toHaveCount(3);
  for (const name of ['dinner', 'stewpot', 'hearty']) {
    await expect(removeBtn(page, name)).toBeVisible();
  }
  await removeBtn(page, 'hearty').click();
  await expect(removeBtn(page, 'hearty')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save imported recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9A-Z]{26}$/);
  const tags = page.getByRole('list', { name: 'Tags', exact: true });
  await expect(tags.getByRole('link')).toHaveText(['dinner', 'stewpot']);

  // Findable by a tag that came from the import, and not by the one that was removed.
  await page.goto('/recipes?q=stewpot');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Imported Tagged Stew' }),
  ).toBeVisible();
  await page.goto('/recipes?q=hearty');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'No recipes found' }),
  ).toBeVisible();
});
