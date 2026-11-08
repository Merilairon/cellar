import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(baseUrl: string | undefined) {
  vi.resetModules();
  if (baseUrl === undefined) vi.stubEnv('BASE_URL', '');
  else vi.stubEnv('BASE_URL', baseUrl);
  const mod = await import('../../next.config');
  return mod.default as { experimental?: Record<string, unknown> };
}

describe('next.config experimental block', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('always sets the proxy body-size limit (Next 16.4.5 experimental, G3)', async () => {
    const cfg = await loadConfig(undefined);
    expect(cfg.experimental?.proxyClientMaxBodySize).toBe('11mb');
    expect(cfg.experimental?.serverActions).toBeUndefined();
  });

  it('merges serverActions.allowedOrigins with the body-size limit when BASE_URL is set', async () => {
    const cfg = await loadConfig('https://recipes.example.com:8443/');
    expect(cfg.experimental?.proxyClientMaxBodySize).toBe('11mb');
    expect(cfg.experimental?.serverActions).toEqual({
      allowedOrigins: ['recipes.example.com:8443'],
    });
  });
});
