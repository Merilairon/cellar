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

describe('import env', () => {
  afterEach(() => vi.unstubAllEnvs());
  const base = {
    SESSION_SECRET: 'q8Zk3vJ0aLm9Xw2RtYb7NcHd5PfUe1GsA4oI6',
    BASE_URL: 'https://example.com',
  };

  async function parse(nodeEnv: string, extra: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', nodeEnv);
    const { parseEnv } = await import('@/lib/env');
    return () => parseEnv({ ...base, ...extra });
  }

  it('has safe defaults', async () => {
    const e = (await parse('production', { DATABASE_PATH: '/data/app.db' }))();
    expect(e.KEEP_RAW_HTML).toBe(false);
    expect(e.IMPORT_ALLOW_LOCAL_FETCH).toBe(false);
    expect(e.RATE_LIMIT_IMPORT_MAX).toBe(20);
    expect(e.RATE_LIMIT_IMPORT_WINDOW_SEC).toBe(3600);
    expect(e.UPLOADS_DIR).toBe('/data/uploads');
    // Same location as v0.3.0 (dirname(uploadsDir)/import-raw), so existing volumes are unaffected.
    expect(e.RAW_HTML_DIR).toBe('/data/import-raw');
  });

  it('honours RAW_HTML_DIR and rejects empty-string override via min(1)', async () => {
    expect((await parse('production', { RAW_HTML_DIR: '/x/raw' }))().RAW_HTML_DIR).toBe('/x/raw');
  });

  it('parses booleans literally ("false" is false) and honours UPLOADS_DIR', async () => {
    const e = (await parse('production', { KEEP_RAW_HTML: 'false', UPLOADS_DIR: '/x/u' }))();
    expect(e.KEEP_RAW_HTML).toBe(false);
    expect(e.UPLOADS_DIR).toBe('/x/u');
    expect((await parse('production', { KEEP_RAW_HTML: 'true' }))().KEEP_RAW_HTML).toBe(true);
    expect(await parse('production', { KEEP_RAW_HTML: 'yes' })).toThrow();
  });

  it('rejects invalid import rate limits', async () => {
    expect(await parse('production', { RATE_LIMIT_IMPORT_MAX: '0' })).toThrow();
    expect(await parse('production', { RATE_LIMIT_IMPORT_WINDOW_SEC: 'abc' })).toThrow();
  });

  it('IMPORT_ALLOW_LOCAL_FETCH is rejected in production and allowed elsewhere', async () => {
    expect(await parse('production', { IMPORT_ALLOW_LOCAL_FETCH: 'true' })).toThrow(
      /development or test/,
    );
    expect(await parse('production', { IMPORT_ALLOW_LOCAL_FETCH: '1' })).toThrow(
      /development or test/,
    );
    expect(
      (await parse('development', { IMPORT_ALLOW_LOCAL_FETCH: 'true' }))().IMPORT_ALLOW_LOCAL_FETCH,
    ).toBe(true);
    expect(
      (await parse('test', { IMPORT_ALLOW_LOCAL_FETCH: 'true' }))().IMPORT_ALLOW_LOCAL_FETCH,
    ).toBe(true);
  });

  it.each(['staging', 'prod', ''])(
    'IMPORT_ALLOW_LOCAL_FETCH is rejected when NODE_ENV=%j',
    async (ne) => {
      expect(await parse(ne, { IMPORT_ALLOW_LOCAL_FETCH: 'true' })).toThrow(/development or test/);
      expect((await parse(ne, {}))().IMPORT_ALLOW_LOCAL_FETCH).toBe(false);
    },
  );
});
