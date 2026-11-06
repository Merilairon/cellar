import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../docker/browser/src/config';
import { createSidecar, RenderError, type Renderer } from '../../../docker/browser/src/server';
import { ImportError, type ImportErrorCode } from './errors';
import { renderPage, type HeadlessConfig } from './headless-client';

// Contract test: the real app client (default http transport) against the real sidecar
// server (docker/browser/src/server.ts) in-process, with only the Chromium renderer stubbed.
// A drift in envelope, status codes or Content-Type on either side fails here.

const TOKEN = '0123456789abcdef0123456789abcdef';
let server: Server;
let cfg: HeadlessConfig;
let ready = true;

const render: Renderer = async (req) => {
  const u = new URL(req.url);
  switch (u.pathname) {
    case '/blocked':
      throw new RenderError('blocked', 403);
    case '/timeout':
      throw new RenderError('timeout', 504);
    case '/private':
      throw new RenderError('private_address', 403);
    case '/toolarge':
      throw new RenderError('too_large', 502);
    case '/failed':
      throw new RenderError('failed', 502);
    case '/crash':
      throw new Error('boom');
    case '/status404':
      return { html: '<p>x</p>', finalUrl: req.url, status: 404 };
    default:
      return { html: '<p>hello</p>', finalUrl: `${u.origin}/final`, status: 200, warnings: 2 };
  }
};

beforeAll(async () => {
  server = createSidecar({
    config: loadConfig({ ...process.env, HEADLESS_TOKEN: TOKEN }),
    render,
    ready: () => ready,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cfg = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token: TOKEN,
    timeoutMs: 10_000,
  };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// The target is a public-looking name; the SSRF pre-check is not what is under test here.
const deps = { assertPublic: async (u: string) => new URL(u) };
const run = (path: string, c: HeadlessConfig = cfg) =>
  renderPage(`https://example.com${path}`, c, deps);
async function code(p: Promise<unknown>): Promise<ImportErrorCode | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).code;
  }
}

describe('app headless client against the real sidecar server', () => {
  it('round-trips a rendered page', async () => {
    expect(await run('/page')).toEqual({
      html: '<p>hello</p>',
      finalUrl: 'https://example.com/final',
      status: 200,
    });
  });

  it.each([
    ['/blocked', 'blocked'],
    ['/timeout', 'timeout'],
    ['/private', 'private_address'],
    ['/toolarge', 'too_large'],
    ['/failed', 'headless_unavailable'],
    ['/crash', 'headless_unavailable'],
    ['/status404', 'fetch_failed'],
  ] as const)('%s maps to %s', async (path, expected) => {
    expect(await code(run(path))).toBe(expected);
  });

  it('a wrong or missing token is headless_unavailable (401 from the server)', async () => {
    expect(await code(run('/page', { ...cfg, token: 'x'.repeat(32) }))).toBe(
      'headless_unavailable',
    );
    expect(await code(run('/page', { ...cfg, token: undefined }))).toBe('headless_unavailable');
  });

  it('an over-long URL is rejected by the server body cap (413 -> too_large)', async () => {
    const long = `https://example.com/${'a'.repeat(2100)}`;
    expect(await code(renderPage(long, cfg, deps))).toBe('too_large');
  });

  it('a sidecar that is not ready is headless_unavailable', async () => {
    ready = false;
    try {
      expect(await code(run('/page'))).toBe('headless_unavailable');
    } finally {
      ready = true;
    }
  });
});
