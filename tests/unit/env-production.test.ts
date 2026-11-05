import { afterEach, describe, expect, it, vi } from 'vitest';

async function prodParse(secret: string) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  const { parseEnv } = await import('@/lib/env');
  return () => parseEnv({ SESSION_SECRET: secret, BASE_URL: 'https://example.com' });
}

describe('SESSION_SECRET placeholder check (production)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    'replace-with-at-least-32-random-characters',
    'changemechangemechangemechangeme12',
    'x'.repeat(40),
  ])('rejects %s', async (s) => {
    expect(await prodParse(s)).toThrow(/placeholder/);
  });

  it('accepts a random secret', async () => {
    expect((await prodParse('q8Zk3vJ0aLm9Xw2RtYb7NcHd5PfUe1GsA4oI6'))()).toBeTruthy();
  });
});
