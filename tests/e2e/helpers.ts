import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import type { RecipeInput } from '@/lib/recipes/schemas';

export const BASE = 'http://localhost:3100';
/** State-changing API calls need a same-origin Origin header (CSRF check). */
export const ORIGIN = { origin: BASE };

export type Account = { email: string; name: string; password: string };

// Created by tests/e2e/auth.spec.ts ("setup -> login"). Files sort alphabetically and run in a
// single worker, so auth.spec.ts always runs first against the fresh e2e DB.
export const ADMIN: Account = {
  email: 'admin@example.test',
  name: 'Admin',
  password: 'admin-password-123',
};

export const account = (slug: string): Account => ({
  email: `${slug}@example.test`,
  name: slug,
  password: `${slug}-password-123`,
});

export async function signIn(page: Page, who: Account) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Admin invites `who` through the UI and the invite is redeemed in a throwaway context, so
 * each spec file owns its users and never depends on another file's leftovers.
 */
export async function registerViaInvite(browser: Browser, who: Account) {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, ADMIN);
  await admin.goto('/admin/users');
  await admin.getByRole('button', { name: 'Create invite link' }).click();
  const link = await admin.getByTestId('one-time-link').first().innerText();
  await adminCtx.close();

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(link);
  await p.getByLabel('Email').fill(who.email);
  await p.getByLabel('Display name').fill(who.name);
  await p.getByLabel(/^Password/).fill(who.password);
  await p.getByRole('button', { name: 'Create account' }).click();
  // A retried beforeAll registers the same user again; email_taken then means "already exists".
  await expect(p).toHaveURL(/\/login|error=email_taken/);
  await ctx.close();
}

/** POST /api/recipes as the signed-in user of `ctx`; returns the created recipe id. */
export async function createRecipe(ctx: BrowserContext, input: RecipeInput | object) {
  const res = await ctx.request.post('/api/recipes', { headers: ORIGIN, data: input });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

export const SAMPLES = { cookie: SAMPLE_SKILLET_COOKIES, cake: SAMPLE_VANILLA_CAKE };

const HYDRATION =
  /hydrat|did not match|didn't match|server rendered HTML|Minified React error #(418|423|425|299)/i;

/**
 * Collects console errors/warnings and uncaught page errors from now on. `hydrationMessages()`
 * returns those that look like a React hydration mismatch; `all()` returns everything, so a
 * test can also assert there was no other page error. Attach it BEFORE the navigation under
 * test, and navigate with a full page load (goto/reload) so the server HTML is hydrated.
 */
export function captureConsole(page: Page) {
  const messages: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
  return {
    all: () => [...messages],
    hydrationMessages: () => messages.filter((m) => HYDRATION.test(m)),
    clear: () => void (messages.length = 0),
  };
}

/**
 * Waits until React has hydrated `locator`'s element (React tags hydrated DOM nodes with a
 * __reactProps$ key). A fill or click before hydration is lost for controlled inputs, so
 * wait on this instead of on the clock.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))))
    .toBe(true);
}

export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

/**
 * Scrolls `locator` into view and waits for the resulting scroll event to be delivered. Menus
 * that close on scroll (grid editor Row actions) would otherwise be closed by the scroll event
 * of Playwright's own auto-scroll, which fires one frame after the click on a tall page.
 */
export async function scrollSettled(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator
    .page()
    .evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
}
