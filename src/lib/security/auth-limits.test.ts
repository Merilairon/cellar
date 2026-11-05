import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }));

import { limitClientOrResponse } from './auth-limits';
import { UNKNOWN_CLIENT } from './request-client';
import { createRateLimiter } from './rate-limit';

describe('limitClientOrResponse', () => {
  it('skips the per-IP limit for the shared unknown client', async () => {
    const l = createRateLimiter({ limit: 1, windowMs: 1000 });
    for (let i = 0; i < 5; i++) expect(await limitClientOrResponse(l, UNKNOWN_CLIENT)).toBeNull();
    expect(l.size()).toBe(0);
  });
  it('still counts a real client IP', async () => {
    const l = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(await limitClientOrResponse(l, '203.0.113.1')).toBeNull();
    const r = await limitClientOrResponse(l, '203.0.113.1');
    expect(r?.status).toBe(429);
  });
});
