import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createRecipe, hydrated, ORIGIN, SAMPLES } from './helpers';

// Shared by share.spec.ts, public-page.spec.ts, share-a11y.spec.ts, share-visual.spec.ts and
// hydration.spec.ts (T7). No test lives here.

export const TOKEN_PATH = /^\/r\/[A-Za-z0-9_-]{22}$/;
export const SOURCE_URL = 'https://www.example-kitchen.test/recipes/vanilla-cake';
export const SOURCE_NAME = 'Example Kitchen';

/** An imported-looking recipe: a source link, a source name and tags. Equal created/updated stamps. */
export const importedCake = (title: string) => ({
  ...SAMPLES.cake,
  title,
  source_url: SOURCE_URL,
  source_name: SOURCE_NAME,
  tags: ['baking', 'dessert'],
});

/** Turn the public link on (or rotate it) through the API; returns the full URL. */
export async function makeLink(ctx: BrowserContext, id: string): Promise<string> {
  const res = await ctx.request.post(`/api/recipes/${id}/share-link`, { headers: ORIGIN });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { share: { url: string } }).share.url;
}

export async function revokeLink(ctx: BrowserContext, id: string) {
  const res = await ctx.request.delete(`/api/recipes/${id}/share-link`, { headers: ORIGIN });
  expect(res.status()).toBe(204);
}

export const tokenOf = (url: string) => new URL(url).pathname.split('/').pop()!;

/** Create a recipe, optionally with a live public link. */
export async function recipeWithLink(
  ctx: BrowserContext,
  input: object,
): Promise<{ id: string; url: string }> {
  const id = await createRecipe(ctx, input);
  return { id, url: await makeLink(ctx, id) };
}

/** Click Share on the recipe page and wait for the dialog (focus lands on its heading). */
export async function openShare(page: Page) {
  const button = page.getByRole('button', { name: 'Share', exact: true });
  await hydrated(button);
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Share recipe' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Share recipe' })).toBeFocused();
  return dialog;
}

export const linkSwitch = (d: ReturnType<Page['locator']>) =>
  d.getByRole('switch', { name: 'Public link' });
export const linkField = (d: ReturnType<Page['locator']>) =>
  d.getByRole('textbox', { name: 'Public link' });

/** Turn the link on through the dialog; resolves with the URL shown in the field. */
export async function turnLinkOn(dialog: ReturnType<Page['locator']>): Promise<string> {
  await linkSwitch(dialog).click();
  await expect(linkSwitch(dialog)).toBeChecked();
  const field = linkField(dialog);
  await expect(field).toBeVisible();
  return field.inputValue();
}

const DATE_RE = /[A-Z][a-z]{2} \d{1,2}, \d{4}/;

/** Replace server-clock dates with a fixed one (the approach of media-visual.spec.ts, d78ed67). */
export async function freezeDates(page: Page) {
  await page.getByText(DATE_RE).evaluateAll((els, src) => {
    const re = new RegExp(src, 'g');
    for (const el of els) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        n.textContent = (n.textContent ?? '').replace(re, 'Jan 1, 2000');
    }
  }, DATE_RE.source);
}

/** Page-level horizontal overflow in px (<= 0 means none). */
export const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** A list-only recipe (no grid layout): the public page's Grid button is disabled for it. */
export const listRecipe = (title: string) => ({
  ...SAMPLES.cookie,
  title,
  view_mode: 'list',
  sections: SAMPLES.cookie.sections.map((s) => ({
    ...s,
    steps: s.steps.map((st) =>
      st.kind === 'column' ? { ...st, row_start: null, row_end: null } : st,
    ),
  })),
});

/** Answer the next matching request with a canned response (one shot), for failure states. */
export async function failOnce(
  page: Page,
  pattern: RegExp,
  method: string,
  status: number,
  body: object | null = { error: 'boom' },
) {
  await page.route(
    pattern,
    (route) =>
      route.request().method() === method
        ? route.fulfill({
            status,
            ...(body ? { contentType: 'application/json', body: JSON.stringify(body) } : {}),
          })
        : route.fallback(),
    { times: 1 },
  );
}
