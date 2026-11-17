import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ trusted: ['127.0.0.1'] as string[], windowSec: 60 }));
const logs = vi.hoisted(() => [] as unknown[][]);
vi.mock('@/lib/log', () => ({ log: (...a: unknown[]) => logs.push(a) }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    TRUSTED_PROXIES: state.trusted,
    RATE_LIMIT_PUBLIC_MAX: 3,
    RATE_LIMIT_PUBLIC_WINDOW_SEC: state.windowSec,
  }),
}));

import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { proxy } from './proxy';

const req = (path: string, xff?: string, cookie = false) =>
  new NextRequest(`http://localhost:3100${path}`, {
    headers: {
      ...(xff ? { 'x-forwarded-for': xff } : {}),
      ...(cookie ? { cookie: `${SESSION_COOKIE}=x` } : {}),
    },
  });
const TOKEN = 'A'.repeat(22);

beforeEach(() => {
  state.trusted = ['127.0.0.1'];
  state.windowSec = 60;
  logs.length = 0;
  (globalThis as { __rateLimiters?: unknown }).__rateLimiters = undefined;
});

describe('proxy: /r/* share links', () => {
  it('sets Referrer-Policy: no-referrer on /r/*, same-origin elsewhere', () => {
    expect(
      proxy(req(`/r/${TOKEN}`, '198.51.100.1, 127.0.0.1')).headers.get('referrer-policy'),
    ).toBe('no-referrer');
    expect(proxy(req('/login')).headers.get('referrer-policy')).toBe('same-origin');
    expect(proxy(req('/recipes', undefined, true)).headers.get('referrer-policy')).toBe(
      'same-origin',
    );
    // A look-alike prefix is not a share path.
    expect(proxy(req('/rx/abc', undefined, true)).headers.get('referrer-policy')).toBe(
      'same-origin',
    );
  });

  it('is reachable without a session cookie (no redirect to login)', () => {
    const res = proxy(req(`/r/${TOKEN}`, '198.51.100.2, 127.0.0.1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('returns 429 with Retry-After and the security headers over the per-IP limit', async () => {
    const hit = (ip: string) => proxy(req(`/r/${TOKEN}`, `${ip}, 127.0.0.1`));
    for (let i = 0; i < 3; i++) expect(hit('203.0.113.7').status).toBe(200);
    const blocked = hit('203.0.113.7');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('referrer-policy')).toBe('no-referrer');
    expect(blocked.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(blocked.headers.get('x-content-type-options')).toBe('nosniff');
    expect(blocked.headers.get('cache-control')).toBe('no-store');
    expect(await blocked.text()).toBe('Too many attempts. Try again later.');
    // Another client is unaffected.
    expect(hit('203.0.113.8').status).toBe(200);
  });

  it('does not limit other paths', () => {
    for (let i = 0; i < 10; i++) {
      expect(proxy(req('/login', '203.0.113.9, 127.0.0.1')).status).toBe(200);
    }
  });

  it('skips the limit when the client is unknown (no TRUSTED_PROXIES)', () => {
    state.trusted = [];
    for (let i = 0; i < 10; i++) {
      expect(proxy(req(`/r/${TOKEN}`, '203.0.113.10')).status).toBe(200);
    }
  });

  it('encoded and look-alike paths cannot dodge the share-path rules', () => {
    for (const path of ['/%72/abc', '/r%2Fabc', '/%2572/x'.replace('%2572', '%72')]) {
      expect(proxy(req(path, undefined, true)).headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('keys IPv6 clients on their /64', () => {
    const hit = (ip: string) => proxy(req(`/r/${TOKEN}`, `${ip}, 127.0.0.1`));
    for (let i = 0; i < 3; i++) hit(`2001:db8:1:2::${i + 1}`);
    expect(hit('2001:db8:1:2:aaaa::9').status).toBe(429);
    expect(hit('2001:db8:1:3::1').status).toBe(200);
  });
});

describe('proxy: public_page.rate_limited log', () => {
  it('logs a count only, no address, and at most once per interval', async () => {
    const { BLOCKED_LOG_INTERVAL_MS } = await import('@/lib/security/public-limit');
    state.windowSec = 3600; // so the limiter window outlives the log interval
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * BLOCKED_LOG_INTERVAL_MS); // past any earlier log
    try {
      const hit = () => proxy(req(`/r/${TOKEN}`, '203.0.113.99, 127.0.0.1'));
      for (let i = 0; i < 3; i++) hit();
      expect(logs).toEqual([]);
      for (let i = 0; i < 5; i++) expect(hit().status).toBe(429);
      // Earlier tests in this file may have left blocked requests uncounted in the module.
      expect(logs).toEqual([['warn', 'public_page.rate_limited', { count: expect.any(Number) }]]);
      expect((logs[0]![2] as { count: number }).count).toBeGreaterThanOrEqual(1);
      vi.setSystemTime(Date.now() + BLOCKED_LOG_INTERVAL_MS + 1);
      hit();
      expect(logs[1]).toEqual(['warn', 'public_page.rate_limited', { count: 5 }]);
      expect(JSON.stringify(logs)).not.toMatch(/203\.0\.113|127\.0\.0\.1/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('limiterKey canonical IPv6 (v0.5.1 Low)', () => {
  it('leading zeros, case and :: expansion share one bucket', async () => {
    const { limiterKey } = await import('@/lib/security/public-limit');
    const key = limiterKey('2001:db8:1:2::1');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(limiterKey('2001:0DB8:0001:0002:0:0:0:1')).toBe(key);
    expect(limiterKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(key);
    expect(limiterKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(limiterKey('2001:0db8:0:0::')).toBe('2001:db8:0:0::/64');
    expect(limiterKey('::1')).toBe('0:0:0:0::/64');
    expect(limiterKey('198.51.100.7')).toBe('198.51.100.7');
  });
});
