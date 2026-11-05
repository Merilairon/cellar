import { describe, expect, it } from 'vitest';
import { createRateLimiter, tooManyRequests } from './rate-limit';

function setup(limit = 3, windowMs = 1000, maxKeys?: number) {
  let t = 1_000_000;
  const l = createRateLimiter({ limit, windowMs, maxKeys, now: () => t });
  return { l, advance: (ms: number) => (t += ms) };
}

describe('rate limiter', () => {
  it('allows up to the limit, blocks N+1 with retry-after', () => {
    const { l } = setup();
    expect([l.hit('a').remaining, l.hit('a').remaining, l.hit('a').remaining]).toEqual([2, 1, 0]);
    const r = l.hit('a');
    expect(r).toMatchObject({ allowed: false, remaining: 0, retryAfterSec: 1 });
  });
  it('allows again after the window', () => {
    const { l, advance } = setup();
    for (let i = 0; i < 4; i++) l.hit('a');
    advance(1000);
    expect(l.hit('a').allowed).toBe(true);
  });
  it('keeps keys separate', () => {
    const { l } = setup(1);
    l.hit('a');
    expect(l.hit('a').allowed).toBe(false);
    expect(l.hit('b').allowed).toBe(true);
  });
  it('reset clears a key', () => {
    const { l } = setup(1);
    l.hit('a');
    l.reset('a');
    expect(l.hit('a').allowed).toBe(true);
  });
  it('prunes expired entries', () => {
    const { l, advance } = setup();
    for (let i = 0; i < 50; i++) l.hit(`k${i}`);
    expect(l.size()).toBe(50);
    advance(1500);
    l.hit('fresh');
    expect(l.size()).toBe(1);
  });
  it('is hard-capped on tracked keys', () => {
    const { l } = setup(3, 1000, 10);
    for (let i = 0; i < 100; i++) l.hit(`k${i}`);
    expect(l.size()).toBe(10);
  });
  it('retryAfter reflects remaining window', () => {
    const { l, advance } = setup(1, 10_000);
    l.hit('a');
    advance(2500);
    expect(l.hit('a').retryAfterSec).toBe(8);
  });
});

describe('tooManyRequests', () => {
  it('is a 429 with Retry-After', () => {
    const r = tooManyRequests(7, 'slow down');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('7');
  });
});
