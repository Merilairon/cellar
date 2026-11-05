import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { account, ADMIN, registerViaInvite, signIn } from './helpers';

// WCAG 2.1 A/AA (including color-contrast) on the auth pages and admin users, light and dark.
// /setup is covered inside auth.spec.ts because it only exists before the first admin.
test.describe.configure({ mode: 'serial' });

const SCHEMES = ['light', 'dark'] as const;
const target = account('pagesa11y');
const links = { register: '', reset: '' };

async function expectNoViolations(page: Page) {
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

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, target);
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await signIn(admin, ADMIN);
  await admin.goto('/admin/users');
  await admin.getByRole('button', { name: 'Create invite link' }).click();
  links.register = await admin.getByTestId('one-time-link').first().innerText();
  await admin
    .getByRole('row')
    .filter({ hasText: target.email })
    .getByRole('button', { name: 'Create reset link' })
    .click();
  links.reset = await admin
    .getByRole('row')
    .filter({ hasText: target.email })
    .getByTestId('one-time-link')
    .innerText();
  await ctx.close();
});

for (const scheme of SCHEMES) {
  test(`axe: login, register and reset pages (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    for (const url of ['/login', links.register, links.reset]) {
      await page.goto(url);
      await expect(page.getByRole('button').first()).toBeVisible();
      await expectNoViolations(page);
    }
    await ctx.close();
  });

  test(`axe: admin users (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await signIn(page, ADMIN);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByTestId('one-time-link').first()).toBeVisible();
    await expectNoViolations(page);
    await ctx.close();
  });
}
