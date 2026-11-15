import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createRecipe, ORIGIN, SAMPLES, signIn, ADMIN } from './helpers';

// T6 (G11, G12, G25): both seed samples print on exactly one landscape page, from the recipe
// page and from the public page, on A4 and Letter, and the print table is not clipped. Page
// count alone hides clipping (overflow: visible cuts at the right edge), so the grid's
// scrollWidth must also fit its clientWidth under print media. Needs auth.spec.ts to have run
// first (it creates the admin), like every spec in this suite.
test.describe.configure({ mode: 'serial' });

// Printable width in CSS px: page width minus the 2 x 10mm @page margin (297mm / 279.4mm).
const FORMATS = [
  { format: 'A4', width: 1047 },
  { format: 'Letter', width: 980 },
] as const;

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
  test.setTimeout(60_000);
  ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, ADMIN);
  await page.close();
  for (const [key, input] of Object.entries(SAMPLES)) {
    const title = `Print ${key} ${Date.now()}`;
    const id = await createRecipe(ctx, { ...input, title });
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
    title: `Print tall ${Date.now()}`,
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
