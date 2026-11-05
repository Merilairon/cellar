import { expect, test } from '@playwright/test';

test('security headers on pages, redirects and API responses', async ({ request }) => {
  for (const path of ['/login', '/']) {
    const res = await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('same-origin');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toMatch(
      /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
    );
    expect(h['strict-transport-security']).toBeUndefined(); // never sent by the app
    expect(h['permissions-policy']).toBeUndefined();
    expect(h['cross-origin-opener-policy']).toBeUndefined();
  }
  const api = await request.get('/api/auth/logout', { maxRedirects: 0 });
  expect(api.headers()['content-security-policy']).toBeTruthy();
});

test('page renders and hydrates under the CSP with no violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // Nonce is stamped on Next's scripts.
  const nonces = await page.locator('script[nonce]').count();
  expect(nonces).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});

test('unknown invite link returns 404 with the translated invalid-link page', async ({ page }) => {
  const res = await page.goto('/register/invalid');
  expect(res?.status()).toBe(404);
  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible();
});
