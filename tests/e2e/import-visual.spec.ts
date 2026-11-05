import { expect, test, type BrowserContext } from '@playwright/test';
import type { Server } from 'node:http';
import { account, registerViaInvite, signIn } from './helpers';
import { apiImport, openReview, panel, previewTables, SEAM, startPages } from './mapping-fixtures';

/**
 * Q6: visual baselines for the high-confidence review state only (the "Automatic grid" panel
 * with badge, state line and the grid preview). Same rules as recipes-visual.spec.ts: baselines
 * come from scripts/update-visual-baselines.sh (pinned Playwright image), never from a laptop.
 * Runs on the SEAM dev server; the dev-tools badge is hidden and the panel (not the page) is
 * captured, so neither the badge nor the per-run fixture port ends up in a baseline.
 */
test.describe.configure({ mode: 'serial' });

const me = account('importvisual');
let setupCtx: BrowserContext;
let pages: Server;
let jobId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  const started = await startPages();
  pages = started.server;
  setupCtx = await browser.newContext({ baseURL: SEAM });
  await signIn(await setupCtx.newPage(), me);
  jobId = (await apiImport(setupCtx, { url: `${started.origin}/high` })).id;
});
test.afterAll(async () => {
  await setupCtx?.close();
  await new Promise((ok) => pages?.close(ok));
});

for (const { w, h } of [
  { w: 375, h: 812 },
  { w: 1280, h: 800 },
]) {
  test(`review panel, high confidence @${w}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: SEAM,
      viewport: { width: w, height: h },
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      storageState: await setupCtx.storageState(),
    });
    const page = await ctx.newPage();
    await openReview(page, jobId);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await expect(previewTables(page)).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    await expect(panel(page)).toHaveScreenshot(`review-high-${w}.png`, {
      animations: 'disabled',
      caret: 'hide',
    });
    await ctx.close();
  });
}
