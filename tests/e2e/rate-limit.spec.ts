import { expect, test } from '@playwright/test';

const headers = (ip: string) => ({
  origin: 'http://localhost:3100',
  'x-forwarded-for': ip,
});

test('login returns 429 with Retry-After after the per-email limit (5 in e2e)', async ({
  request,
}) => {
  const attempt = (ip: string) =>
    request.post('/api/auth/login', {
      headers: headers(ip),
      form: { email: 'nobody@example.test', password: 'wrong-password-123' },
      maxRedirects: 0,
    });
  for (let i = 0; i < 5; i++) expect((await attempt('203.0.113.10')).status()).toBe(303);
  const blocked = await attempt('203.0.113.10');
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
  expect(await blocked.text()).toContain('Too many attempts');
});

test('invite registration is limited per trusted client IP', async ({ request }) => {
  const attempt = (ip: string) =>
    request.post('/api/auth/register', {
      headers: headers(ip),
      form: { token: 'x' },
      maxRedirects: 0,
    });
  for (let i = 0; i < 10; i++) expect((await attempt('203.0.113.20')).status()).toBe(303);
  expect((await attempt('203.0.113.20')).status()).toBe(429);
  // A different client IP is unaffected.
  expect((await attempt('203.0.113.21')).status()).toBe(303);
});
