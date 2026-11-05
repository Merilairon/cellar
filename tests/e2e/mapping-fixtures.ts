import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';

/**
 * Shared pieces of the mapper review e2e specs (import-mapping, import-mapping-a11y,
 * import-visual). They all talk to the SEAM dev server (:3101), see import.spec.ts.
 *
 * Confidence of each fixture page was measured with the real mapper:
 *  - /high      sample A text, 9 ingredients, 7 steps          -> high (1.00)
 *  - /medium    "Combine everything ..." group reference         -> medium (0.55)
 *  - /low       steps that name no ingredient                     -> low (0.00)
 *  - /sections  fixtures/import/map-jsonld-sections-and-groups    -> high, two sections
 */
export const SEAM = 'http://localhost:3101';
export const SEAM_ORIGIN = { origin: SEAM };
const DB_FILE = 'data/e2e.db'; // DATABASE_PATH of both e2e servers

const cookie = SAMPLE_SKILLET_COOKIES.sections[0];

function ldPage(node: object) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${(node as { name: string }).name}</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', ...node }).replace(/</g, '\\u003c')}</script></head><body></body></html>`;
}

export const PAGES: Record<string, string> = {
  high: ldPage({
    name: 'Fixture Skillet Cookie',
    recipeYield: '8 wedges',
    prepTime: 'PT15M',
    cookTime: 'PT35M',
    recipeIngredient: cookie.ingredients.map((i) => i.raw_text),
    recipeInstructions: cookie.steps.map((s) => s.detail),
  }),
  medium: ldPage({
    name: 'Fixture Vague Batter',
    recipeYield: '4 servings',
    prepTime: 'PT10M',
    recipeIngredient: ['2 cups flour', '1 cup sugar', '3 eggs'],
    recipeInstructions: ['Combine everything thoroughly in a big bowl.', 'Cook it.', 'Serve warm.'],
  }),
  low: ldPage({
    name: 'Fixture Mystery Dish',
    recipeYield: '2 servings',
    prepTime: 'PT5M',
    recipeIngredient: ['2 cups flour', '1 cup sugar', '3 eggs'],
    recipeInstructions: ['Do the thing.', 'Wait a bit.'],
  }),
  sections: readFileSync(
    join(process.cwd(), 'tests/fixtures/import/map-jsonld-sections-and-groups.html'),
    'utf8',
  ),
};
export const PASTE_TEXT = readFileSync(
  join(process.cwd(), 'tests/fixtures/import/map-paste-for-the-sauce.txt'),
  'utf8',
);

/** Serves PAGES at /<name> and /<name>-<anything> (a distinct URL gives a distinct job and no duplicate banner). */
export async function startPages(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const name = (req.url ?? '').replace(/^\//, '').split('-')[0];
    const body = PAGES[name];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

export type Job = { id: string; mapping_level: 'high' | 'medium' | 'low' | null; status: string };

/** Setup through the API (not the form): returns the job whose review screen is /import/<id>. */
export async function apiImport(
  ctx: BrowserContext,
  body: { url: string } | { text: string },
): Promise<Job> {
  const res = await ctx.request.post(`${SEAM}/api/import`, { headers: SEAM_ORIGIN, data: body });
  expect(res.status()).toBe(200);
  const job = (await res.json()) as Job;
  expect(job.status).toBe('needs_review');
  return job;
}

/** Rewrites the stored draft of a job the way a tampered database row would look. */
export function tamperDraft(jobId: string, edit: (draft: Record<string, unknown>) => void) {
  const db = new Database(DB_FILE);
  try {
    const row = db.prepare('SELECT draft_json FROM import_job WHERE id = ?').get(jobId) as {
      draft_json: string;
    };
    const stored = JSON.parse(row.draft_json) as { draft: Record<string, unknown> };
    edit(stored.draft);
    db.prepare('UPDATE import_job SET draft_json = ? WHERE id = ?').run(
      JSON.stringify(stored),
      jobId,
    );
  } finally {
    db.close();
  }
}

/** `next dev` hydrates late; a fill or click before that is lost. React tags hydrated nodes. */
export async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))))
    .toBe(true);
}

/** Opens the review screen of a job with a full page load and waits until it is interactive. */
export async function openReview(page: Page, jobId: string) {
  await page.goto(`${SEAM}/import/${jobId}`);
  await expect(page.getByRole('heading', { name: 'Review the imported recipe' })).toBeVisible();
  await hydrated(page.getByLabel('Title', { exact: true }));
}

/** The "Automatic grid" panel. */
export const panel = (page: Page) => page.getByRole('region', { name: 'Automatic grid' });
export const stateLine = (page: Page) => page.locator('#map-state');
/** The preview disclosure's content (it is a <details> inside the panel). */
export const previewTables = (page: Page) => panel(page).locator('table.rg-table');

/** Row-span input of step `n` (1-based) in the first section: 'First' or 'Last' ingredient row. */
export const spanInput = (page: Page, n: number, which: 'First' | 'Last') =>
  page
    .getByRole('group', { name: `Step ${n}` })
    .first()
    .getByLabel(`${which} ingredient row`);

export const rowSpans = (tables: Locator) =>
  tables
    .first()
    .locator('td.rg-step')
    .evaluateAll((tds) => tds.map((td) => (td as HTMLTableCellElement).rowSpan));
