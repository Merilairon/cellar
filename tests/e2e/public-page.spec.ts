import { expect, test, type APIResponse, type BrowserContext } from '@playwright/test';
import { account, ORIGIN, registerViaInvite, SAMPLES, signIn } from './helpers';
import {
  importedCake,
  makeLink,
  pageOverflow,
  recipeWithLink,
  revokeLink,
  SOURCE_NAME,
  SOURCE_URL,
  tokenOf,
} from './share-support';

// T7: the anonymous public page /r/:token (T4). Everything here is a request without cookies.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });

const me = account('publicpage');
let ctx: BrowserContext;
const live = { id: '', url: '' };
const tokens = { revoked: '', deleted: '' };
const UNKNOWN = 'AAAAAAAAAAAAAAAAAAAAAA'; // well-formed (22 url-safe chars), never issued

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await registerViaInvite(browser, me);
  ctx = await browser.newContext();
  await signIn(await ctx.newPage(), me);
  Object.assign(live, await recipeWithLink(ctx, importedCake('Public Page Cake')));
  // A revoked token and the token of a deleted recipe: both must look like any other miss.
  const revoked = await recipeWithLink(ctx, { ...SAMPLES.cookie, title: 'Public Revoked' });
  tokens.revoked = tokenOf(revoked.url);
  await revokeLink(ctx, revoked.id);
  const deleted = await recipeWithLink(ctx, { ...SAMPLES.cookie, title: 'Public Deleted' });
  tokens.deleted = tokenOf(deleted.url);
  const del = await ctx.request.delete(`/api/recipes/${deleted.id}`, { headers: ORIGIN });
  expect(del.status()).toBe(204);
});
test.afterAll(async () => ctx?.close());

/** Status, headers and body of a response with everything per-request normalised away. */
async function fingerprint(res: APIResponse, token: string) {
  const headers: Record<string, string> = { ...res.headers() };
  const nonce = /'nonce-([^']+)'/.exec(headers['content-security-policy'] ?? '')?.[1];
  for (const k of ['date', 'content-length', 'etag', 'x-request-id']) delete headers[k];
  let body = await res.text();
  const scrub = (s: string) => {
    let out = s;
    if (nonce) out = out.split(nonce).join('NONCE');
    for (const t of new Set([token, encodeURIComponent(token)])) out = out.split(t).join('TOKEN');
    return out;
  };
  body = scrub(body);
  for (const k of Object.keys(headers)) headers[k] = scrub(headers[k]);
  return { status: res.status(), headers, body };
}

test('every miss is the same 404: malformed, unknown, revoked and deleted-recipe tokens', async ({
  request,
}) => {
  const probes = {
    unknown: UNKNOWN,
    revoked: tokens.revoked,
    deleted: tokens.deleted,
    tooShort: 'abc',
    tooLong: 'A'.repeat(23),
    badChars: 'AAAAAAAAAAAAAAAAAAAA.!',
    encoded: 'AAAAAAAAAAAAAAAAAAAA%20%20',
  };
  const prints: Record<string, Awaited<ReturnType<typeof fingerprint>>> = {};
  for (const [name, token] of Object.entries(probes)) {
    const res = await request.get(`/r/${token}`, { maxRedirects: 0 });
    prints[name] = await fingerprint(res, token);
    expect(prints[name].status, name).toBe(404);
    expect(prints[name].headers['referrer-policy'], name).toBe('no-referrer');
  }
  const base = prints.unknown;
  expect(base.body).toContain('This link is invalid or has expired.');
  for (const [name, p] of Object.entries(prints)) {
    expect(p.status, name).toBe(base.status);
    expect(p.headers, name).toEqual(base.headers);
    expect(p.body, name).toBe(base.body); // byte for byte, after nonce and token normalisation
  }
});

test('the live page: 200, no-referrer, noindex meta, source banner, no tag links', async ({
  page,
  request,
}) => {
  const res = await request.get(live.url, { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');

  await page.goto(live.url);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page).toHaveTitle(/Public Page Cake/);
  const banner = page.getByText(/^Recipe from Example Kitchen\./);
  await expect(banner).toContainText(
    'Shared read-only via Cellar, not affiliated with the source.',
  );
  const link = banner.getByRole('link', { name: SOURCE_NAME });
  await expect(link).toHaveAttribute('href', SOURCE_URL);
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByText('Shared read-only link from a private recipe book.')).toBeVisible();
  // Tags show as plain text: a link would send a guest to the login page.
  await expect(page.getByText('baking', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'baking' })).toHaveCount(0);
});

test('robots.txt disallows everything; the app pages keep Referrer-Policy same-origin', async ({
  request,
}) => {
  const robots = await request.get('/robots.txt', { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  const txt = await robots.text();
  expect(txt).toMatch(/User-Agent: \*/i);
  expect(txt).toMatch(/Disallow: \/(\s|$)/);
  expect(txt).not.toMatch(/^Allow:/im);

  const login = await request.get('/login', { maxRedirects: 0 });
  expect(login.headers()['referrer-policy']).toBe('same-origin');
  const api = await request.get('/api/health');
  expect(api.headers()['referrer-policy']).toBe('same-origin');
  // Only /r/* is scoped: not a path that merely contains it.
  const near = await request.get('/register/r/x', { maxRedirects: 0 });
  expect(near.headers()['referrer-policy']).toBe('same-origin');
});

test('429 after the per-IP limit, with Retry-After and the security headers; other IPs unaffected', async ({
  request,
}) => {
  // The e2e server trusts loopback (TRUSTED_PROXIES) and sets RATE_LIMIT_PUBLIC_MAX=20, see
  // playwright.config.ts. Requests without x-forwarded-for come from an unknown client and are
  // never limited, so the other tests in this file are unaffected. src/proxy.test.ts and
  // public-limit tests cover the /64 keying and the fail-open cases.
  const LIMIT = 20;
  const hit = (ip: string, path = `/r/${UNKNOWN}`) =>
    request.get(path, { headers: { 'x-forwarded-for': ip }, maxRedirects: 0 });
  for (let i = 1; i <= LIMIT; i++)
    expect((await hit('198.51.100.77')).status(), `hit ${i}`).toBe(404);
  const blocked = await hit('198.51.100.77');
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
  expect(blocked.headers()['referrer-policy']).toBe('no-referrer');
  expect(blocked.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(blocked.headers()['cache-control']).toBe('no-store');
  expect(await blocked.text()).toBe('Too many attempts. Try again later.');
  // A valid link is limited too, and a different client is served.
  expect((await hit('198.51.100.77', new URL(live.url).pathname)).status()).toBe(429);
  expect((await hit('198.51.100.78', new URL(live.url).pathname)).status()).toBe(200);
  // Not an /r/ path: the public limiter does not apply (the app's own pages stay reachable).
  expect((await hit('198.51.100.77', '/login')).status()).not.toBe(429);
});

test('scale x2 and the unit toggle work without a session and store nothing', async ({
  browser,
}) => {
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await guest.newPage();
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url());
  });
  await page.goto(live.url);
  const table = page.locator('table.rg-table').first();
  const original = await table.innerText();

  await page.getByRole('button', { name: '2x', exact: true }).click();
  await expect(page.getByText(/Showing amounts at 2x/)).toBeVisible();
  await expect.poll(() => table.innerText()).not.toBe(original);
  const doubled = await table.innerText();

  await page.getByRole('button', { name: 'Show in US units' }).click();
  await expect(page.getByRole('button', { name: 'Show in metric' })).toBeVisible();
  await expect(page.getByText(/Units: US\./)).toBeVisible();
  await expect.poll(() => table.innerText()).not.toBe(doubled);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText('Showing the original amounts.')).toBeVisible();
  await expect.poll(() => table.innerText()).toBe(original);

  // Grid and list toggle (view state only).
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('table.rg-table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('table.rg-table').first()).toBeVisible();

  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(await guest.cookies()).toEqual([]);
  expect(apiCalls).toEqual([]);
  await guest.close();
});

for (const scheme of ['light', 'dark'] as const) {
  for (const w of [375, 768, 1280]) {
    test(`no page-level horizontal overflow (${scheme}, ${w}px)`, async ({ browser }) => {
      const guest = await browser.newContext({
        viewport: { width: w, height: 800 },
        colorScheme: scheme,
      });
      const page = await guest.newPage();
      await page.goto(live.url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      // The grid scrolls inside its own region instead (scale 2x makes it wider still).
      await page.getByRole('button', { name: '2x', exact: true }).click();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      await guest.close();
    });
  }
}

test('a link turned off a moment ago and a rotated token both fall into the same 404', async ({
  request,
}) => {
  const { id, url } = await recipeWithLink(ctx, { ...SAMPLES.cookie, title: 'Public Rotate' });
  const oldToken = tokenOf(url);
  const next = tokenOf(await makeLink(ctx, id));
  const a = await fingerprint(await request.get(`/r/${oldToken}`, { maxRedirects: 0 }), oldToken);
  const b = await fingerprint(await request.get(`/r/${UNKNOWN}`, { maxRedirects: 0 }), UNKNOWN);
  expect(a).toEqual(b);
  expect((await request.get(`/r/${next}`)).status()).toBe(200);
});
