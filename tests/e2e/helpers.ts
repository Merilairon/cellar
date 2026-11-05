import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
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
  await expect(p).toHaveURL(/\/login/);
  await ctx.close();
}

/** POST /api/recipes as the signed-in user of `ctx`; returns the created recipe id. */
export async function createRecipe(ctx: BrowserContext, input: RecipeInput | object) {
  const res = await ctx.request.post('/api/recipes', { headers: ORIGIN, data: input });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

export const SAMPLES = { cookie: SAMPLE_SKILLET_COOKIES, cake: SAMPLE_VANILLA_CAKE };
