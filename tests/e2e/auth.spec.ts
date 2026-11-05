import { expect, test } from '@playwright/test';

// One fresh DB per run (see playwright.config.ts); steps depend on each other.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin@example.test', name: 'Admin', password: 'admin-password-123' };
const MEMBER = { email: 'member@example.test', name: 'Member', password: 'member-password-123' };

test('unauthenticated request to a protected page redirects to /login', async ({ request }) => {
  const res = await request.get('/', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()['location'], 'http://x').pathname).toBe('/login');
  expect((await request.get('/api/auth/logout', { maxRedirects: 0 })).status()).toBe(401);
});

test('setup -> login', async ({ page }) => {
  await page.goto('/setup');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Display name').fill(ADMIN.name);
  await page.getByLabel(/^Password/).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Recipe Book' })).toBeVisible();

  const res = await page.request.get('/setup');
  expect(res.status()).toBe(404);
});

test('admin invites a member who registers and logs in; member cannot reach admin', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = await page.getByTestId('one-time-link').first().innerText();
  expect(link).toContain('/register/');

  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await m.goto(link);
  await m.getByLabel('Email').fill(MEMBER.email);
  await m.getByLabel('Display name').fill(MEMBER.name);
  await m.getByLabel(/^Password/).fill(MEMBER.password);
  await m.getByRole('button', { name: 'Create account' }).click();
  await expect(m).toHaveURL(/\/login/);
  expect((await m.request.get(link)).status()).toBe(404); // single-use

  await m.getByLabel('Email').fill(MEMBER.email);
  await m.getByLabel('Password').fill(MEMBER.password);
  await m.getByRole('button', { name: 'Sign in' }).click();
  await expect(m).toHaveURL(/\/$/);
  await m.goto('/admin/users');
  await expect(m).toHaveURL(/\/$/); // member bounced from admin page
  await ctx.close();
});
