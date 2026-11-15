import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { account, createRecipe, ORIGIN, registerViaInvite, SAMPLES, signIn } from './helpers';
import { importedCake, SOURCE_NAME, SOURCE_URL } from './share-support';

// T6 (G11, G12, G25): both seed samples print on exactly one landscape page, from the recipe
// page and from the public page, on A4 and Letter, and the print table is not clipped. Page
// count alone hides clipping (overflow: visible cuts at the right edge), so the grid's
// scrollWidth must also fit its clientWidth under print media. The spec owns its user (invited
// through the admin like every spec, so auth.spec.ts must have created the admin first, which the
// alphabetical single-worker order guarantees) and shares only its own recipes, so it does not
// depend on any other spec's leftovers or run order.
test.describe.configure({ mode: 'serial' });

// Printable width in CSS px: page width minus the 2 x 10mm @page margin (297mm / 279.4mm).
const FORMATS = [
  { format: 'A4', width: 1047 },
  { format: 'Letter', width: 980 },
] as const;

const me = account('printer');
let ctx: BrowserContext;
const targets: { name: string; recipe: string; pub: string }[] = [];
let tall = '';

/** Chromium writes one `/Type /Page` dictionary per page (never `/Pages`). */
const pageCount = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;

async function share(id: string) {
  const res = await ctx.request.post(`/api/recipes/${id}/share-link`, { headers: ORIGIN });
  expect(res.status()).toBe(201);
  const { share: s } = (await res.json()) as { share: { url: string } };
  return new URL(s.url).pathname;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, me);
  await page.close();
  // The tallest case: a source line, a source name and tags on top of the grid (the public page
  // adds the attribution banner), so one page has to hold all of it.
  for (const [key, input] of Object.entries(SAMPLES)) {
    const title = `Print ${key}`;
    const id = await createRecipe(ctx, {
      ...importedCake(title),
      ...input,
      title,
      source_url: SOURCE_URL,
      source_name: SOURCE_NAME,
      tags: ['baking', 'dessert'],
    });
    targets.push({ name: input.title, recipe: `/recipes/${id}`, pub: await share(id) });
  }
  // 60 ingredient rows in one column cannot fit one page: proves the counter counts pages.
  const base = SAMPLES.cookie;
  const rows = Array.from({ length: 60 }, (_, i) => ({
    ...base.sections[0].ingredients[0],
    name: `item ${i}`,
  }));
  tall = await createRecipe(ctx, {
    ...base,
    title: 'Print tall',
    sections: [
      {
        title: null,
        ingredients: rows,
        steps: [{ kind: 'column', label: 'mix', detail: '', row_start: 0, row_end: 59 }],
      },
    ],
  });
});
test.afterAll(async () => ctx.close());

async function openPrint(path: string, width: number): Promise<Page> {
  const p = await ctx.newPage();
  await p.setViewportSize({ width, height: 800 });
  await p.goto(path);
  await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
  // Dark system scheme: print must still be light.
  await p.emulateMedia({ media: 'print', colorScheme: 'dark' });
  return p;
}

const pageOverflowPx = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const overflow = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.rg-scroller')].map((s) => ({
      scroll: s.scrollWidth,
      client: s.clientWidth,
      table: (s.firstElementChild as HTMLElement).scrollWidth,
    })),
  );

for (const where of ['recipe', 'pub'] as const) {
  for (const { format, width } of FORMATS) {
    for (const sample of ['Mocha Skillet Cookie', 'Vanilla Cake with Frosting']) {
      test(`${sample} prints on one ${format} landscape page (${where})`, async () => {
        const t = targets.find((x) => x.name === sample)!;
        const p = await openPrint(t[where], width);
        const grids = await overflow(p);
        expect(grids.length).toBeGreaterThan(0);
        for (const g of grids) {
          expect(g.scroll).toBeLessThanOrEqual(g.client);
          expect(g.table).toBeLessThanOrEqual(g.client);
        }
        // Chrome, controls and the light theme.
        await expect(p.locator('header')).toBeHidden();
        await expect(p.getByRole('button', { name: 'Print' })).toBeHidden();
        await expect(p.getByRole('button', { name: 'Reset' })).toBeHidden();
        const colours = await p.evaluate(() => ({
          page: getComputedStyle(document.documentElement).backgroundColor,
          ink: getComputedStyle(document.body).color,
        }));
        expect(colours).toEqual({ page: 'rgb(255, 255, 255)', ink: 'rgb(31, 42, 31)' });
        expect(await pageOverflowPx(p)).toBeLessThanOrEqual(0);
        const pdf = await p.pdf({
          format,
          landscape: true,
          printBackground: true,
          preferCSSPageSize: true,
        });
        expect(pageCount(pdf)).toBe(1);
        await p.close();
      });
    }
  }
}

test('a grid taller than a page prints on more pages instead of clipping', async () => {
  const p = await openPrint(`/recipes/${tall}`, 1047);
  const pdf = await p.pdf({
    format: 'A4',
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect(pageCount(pdf)).toBeGreaterThan(1);
  await p.close();
});

test('source URL is printed after the source link; tags print as one line; chips stay on screen', async () => {
  for (const where of ['recipe', 'pub'] as const) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 1047, height: 800 });
    await p.goto(targets[0][where]);
    const link = p.getByRole('link', { name: SOURCE_NAME });
    await expect(link).toHaveAttribute('href', SOURCE_URL);
    const after = () => link.evaluate((a) => getComputedStyle(a, '::after').content);

    // Screen: nothing is appended, tags are chips (recipe page: links, public page: text).
    await p.emulateMedia({ media: 'screen' });
    expect(await after()).toBe('none');
    await expect(p.getByText('Tags: baking, dessert')).toBeHidden();
    await expect(p.getByText('baking', { exact: true })).toBeVisible();

    // Print: the address follows the name, tags are one comma-separated line, chips are gone.
    await p.emulateMedia({ media: 'print' });
    expect(await after()).toBe(`" (${SOURCE_URL})"`);
    await expect(p.getByText('Tags: baking, dessert')).toBeVisible();
    await expect(p.getByText('baking', { exact: true })).toBeHidden();
    await p.close();
  }
});

test('on paper the source line comes before the facts line (UX spec 4.1 items 2 and 3)', async () => {
  for (const where of ['recipe', 'pub'] as const) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 1047, height: 800 });
    await p.goto(targets[0][where]);
    await p.emulateMedia({ media: 'print' });
    const y = async (re: RegExp) => (await p.getByText(re).first().boundingBox())!.y;
    const title = (await p.getByRole('heading', { level: 1 }).boundingBox())!.y;
    const source = await y(where === 'recipe' ? /^Source:/ : /^Recipe from/);
    const facts = await y(/^Serves \d/);
    const tags = await y(/^Tags:/);
    expect(title).toBeLessThan(source);
    expect(source).toBeLessThan(facts);
    expect(facts).toBeLessThan(tags);
    await p.close();
  }
});

test('the Include notes option prints notes only when ticked; public page has none', async () => {
  const t = targets[0];
  const id = t.recipe.split('/').pop()!;
  const res = await ctx.request.post(`/api/recipes/${id}/notes`, {
    headers: ORIGIN,
    data: { body: 'Less sugar next time', shared: false },
  });
  expect(res.status()).toBe(201);

  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1047, height: 800 });
  await p.goto(t.recipe);
  const box = p.getByLabel('Include notes when printing');
  await expect(box).not.toBeChecked();
  await p.emulateMedia({ media: 'print' });
  await expect(p.getByText('Less sugar next time')).toBeHidden();
  await p.emulateMedia({ media: 'screen' });
  await box.check();
  await p.emulateMedia({ media: 'print' });
  const printed = p.locator('[data-print-notes]');
  await expect(printed).toBeVisible();
  await expect(printed).toContainText('Less sugar next time');
  await expect(printed).toContainText('Only you');
  await p.close();

  const pub = await ctx.newPage();
  await pub.goto(t.pub);
  await expect(pub.getByLabel('Include notes when printing')).toHaveCount(0);
  await expect(pub.getByRole('button', { name: 'Print' })).toBeVisible();
  await pub.close();
});
