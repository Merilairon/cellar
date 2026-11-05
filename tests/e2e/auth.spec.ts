import AxeBuilder from '@axe-core/playwright';
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
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
      `setup page axe (${scheme})`,
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Display name').fill(ADMIN.name);
  await page.getByLabel(/^Password/).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Cellar' })).toBeVisible();

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

test('shell: nav visibility by role, profile unit_pref, theme, logout, 375px nav', async ({
  page,
  browser,
}) => {
  const signIn = async (p: typeof page, u: typeof ADMIN) => {
    await p.goto('/login');
    await p.getByLabel('Email').fill(u.email);
    await p.getByLabel('Password').fill(u.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await expect(p).toHaveURL(/\/$/);
  };

  // Admin at desktop width sees all three links.
  await signIn(page, ADMIN);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const n of ['Recipes', 'Import', 'Admin']) {
    await expect(nav.getByRole('link', { name: n })).toBeVisible();
  }

  // Profile: unit_pref persists after reload.
  await page.goto('/profile');
  await page.getByLabel('Units').selectOption('us');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved.');
  await page.reload();
  await expect(page.getByLabel('Units')).toHaveValue('us');

  // Theme toggle persists across reload (system -> light).
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Member at 375px: no Admin link, collapsed nav is usable, no horizontal scroll.
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const m = await ctx.newPage();
  await signIn(m, MEMBER);
  await expect(m.getByRole('link', { name: 'Recipes' })).toBeHidden();
  await m.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(m.getByRole('link', { name: 'Recipes' })).toBeVisible();
  await expect(m.getByRole('link', { name: 'Import' })).toBeVisible();
  await expect(m.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await m.getByRole('link', { name: 'Recipes' }).click();
  await expect(m).toHaveURL(/\/recipes$/);

  // Logout via the user menu ends the session.
  await m.getByRole('button', { name: /^Account menu/ }).click();
  await m.getByRole('button', { name: 'Sign out' }).click();
  await expect(m).toHaveURL(/\/login$/);
  await m.goto('/recipes');
  await expect(m).toHaveURL(/\/login$/);
  await ctx.close();
});

test('admin deletes a member, last admin is protected', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: new RegExp(MEMBER.email) });
  await row.getByText('Delete user').click();
  await row.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('row', { name: new RegExp(MEMBER.email) })).toHaveCount(0);
  const admin = page.getByRole('row', { name: new RegExp(ADMIN.email) });
  await admin.getByText('Delete user').click();
  await admin.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText('The last active admin cannot be deleted.')).toBeVisible();
});
