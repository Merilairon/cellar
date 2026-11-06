import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportError, type ImportErrorCode } from './errors';
import {
  createHeadless,
  isHeadlessEnabled,
  MAX_RENDER_HTML,
  MAX_RENDER_WIRE,
  renderPage,
  type HeadlessConfig,
  type HeadlessTransport,
  type HeadlessTransportResponse,
} from './headless-client';
const CONFIG: HeadlessConfig = { url: 'http://browser:3001', timeoutMs: 35_000 };
const TOKEN = 'secret-token-0123456789abcdef';
const enc = new TextEncoder();

const resp = (
  status: number,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' },
): HeadlessTransportResponse => {
  const buf = enc.encode(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    status,
    headers,
    body: (async function* () {
      yield buf;
    })(),
    destroy: vi.fn(),
  };
};
const okBody = (over: Record<string, unknown> = {}) => ({
  html: '<html>ok</html>',
  finalUrl: 'https://example.com/final',
  status: 200,
  ...over,
});
const publicOk = async () => new URL('https://example.com/final');
const stub = (r: HeadlessTransportResponse | Error) =>
  vi.fn<HeadlessTransport>(async () => {
    if (r instanceof Error) throw r;
    return r;
  });

async function code(p: Promise<unknown>): Promise<ImportErrorCode> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).code;
  }
  throw new Error('expected rejection');
}

const run = (t: HeadlessTransport, over: Partial<Parameters<typeof renderPage>[2]> = {}) =>
  renderPage('https://example.com/r', CONFIG, { transport: t, assertPublic: publicOk, ...over });

describe('headless client: success', () => {
  it('returns html, finalUrl and status; accepts the optional warnings count', async () => {
    const t = stub(resp(200, okBody({ warnings: 3 })));
    const r = await run(t);
    expect(r).toEqual({
      html: '<html>ok</html>',
      finalUrl: 'https://example.com/final',
      status: 200,
    });
  });

  it('sends only { url } as JSON to /render', async () => {
    const t = stub(resp(200, okBody()));
    await run(t);
    const req = t.mock.calls[0]![0];
    expect(JSON.parse(req.body)).toEqual({ url: 'https://example.com/r' });
    expect(req.url.href).toBe('http://browser:3001/');
  });
});

describe('headless client: token', () => {
  it('sends the bearer token only when configured', async () => {
    const withTok = stub(resp(200, okBody()));
    await renderPage(
      'https://example.com/r',
      { ...CONFIG, token: TOKEN },
      {
        transport: withTok,
        assertPublic: publicOk,
      },
    );
    expect(withTok.mock.calls[0]![0].headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    const without = stub(resp(200, okBody()));
    await run(without);
    expect(without.mock.calls[0]![0].headers['Authorization']).toBeUndefined();
  });

  it('never logs the token or the HTML', async () => {
    const log = vi.fn();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const t = stub(resp(200, okBody({ html: '<p>SECRET-HTML</p>' })));
    await renderPage(
      'https://example.com/r?q=1',
      { ...CONFIG, token: TOKEN },
      {
        transport: t,
        assertPublic: publicOk,
        log,
      },
    );
    const logged = JSON.stringify([log.mock.calls, spy.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('SECRET-HTML');
    expect(log).toHaveBeenCalledWith('headless render host=example.com');
    spy.mockRestore();
  });
});

describe('headless client: sidecar error mapping', () => {
  it.each([
    ['blocked', 403, 'blocked'],
    ['timeout', 504, 'timeout'],
    ['private_address', 422, 'private_address'],
    ['too_large', 413, 'too_large'],
    ['failed', 500, 'headless_unavailable'],
    ['failed', 503, 'headless_unavailable'],
    ['failed', 401, 'headless_unavailable'],
  ])('sidecar %s (%i) -> %s', async (error, status, expected) => {
    expect(await code(run(stub(resp(status, { error }))))).toBe(expected);
  });

  it('does not forward sidecar text', async () => {
    try {
      await run(stub(resp(500, { error: 'failed', message: 'boom at /secret/path' })));
    } catch (e) {
      expect((e as Error).message).not.toContain('secret');
    }
  });

  it('unknown error shape or non-JSON error body -> headless_unavailable', async () => {
    expect(await code(run(stub(resp(500, { error: 'weird' }))))).toBe('headless_unavailable');
    expect(await code(run(stub(resp(500, 'oops <html>'))))).toBe('headless_unavailable');
  });

  it('connection failure -> headless_unavailable', async () => {
    const e = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(await code(run(stub(e)))).toBe('headless_unavailable');
  });

  it('page status mapping: 403/429 blocked, 404 fetch_failed', async () => {
    expect(await code(run(stub(resp(200, okBody({ status: 403 })))))).toBe('blocked');
    expect(await code(run(stub(resp(200, okBody({ status: 429 })))))).toBe('blocked');
    expect(await code(run(stub(resp(200, okBody({ status: 404 })))))).toBe('fetch_failed');
  });
});

describe('headless client: hostile responses', () => {
  it('rejects a non-JSON content type', async () => {
    const r = resp(200, okBody(), { 'content-type': 'text/html' });
    expect(await code(run(stub(r)))).toBe('headless_unavailable');
    expect(r.destroy).toHaveBeenCalled();
  });

  it('rejects a content-encoded response', async () => {
    const r = resp(200, okBody(), {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    expect(await code(run(stub(r)))).toBe('headless_unavailable');
  });

  it('rejects malformed JSON and wrong shapes', async () => {
    expect(await code(run(stub(resp(200, '{"html":'))))).toBe('headless_unavailable');
    expect(await code(run(stub(resp(200, { html: 1, finalUrl: 'x', status: 200 }))))).toBe(
      'headless_unavailable',
    );
    expect(await code(run(stub(resp(200, { html: 'x', status: 200 }))))).toBe(
      'headless_unavailable',
    );
    expect(await code(run(stub(resp(200, okBody({ warnings: -1 })))))).toBe('headless_unavailable');
  });

  it('HTML over the 5 MiB cap -> too_large', async () => {
    const big = 'a'.repeat(MAX_RENDER_HTML + 1);
    expect(await code(run(stub(resp(200, okBody({ html: big })))))).toBe('too_large');
  });

  it('a private finalUrl is rejected with private_address', async () => {
    const assertPublic = vi.fn(async (u: string) => {
      if (u.includes('169.254')) throw new ImportError('private_address');
      return new URL(u);
    });
    const t = stub(resp(200, okBody({ finalUrl: 'http://169.254.169.254/latest' })));
    expect(await code(run(t, { assertPublic }))).toBe('private_address');
  });

  it('a malformed finalUrl -> headless_unavailable', async () => {
    const assertPublic = vi.fn(async (u: string) => {
      if (u === 'not a url') throw new ImportError('invalid_url');
      return new URL(u);
    });
    const t = stub(resp(200, okBody({ finalUrl: 'not a url' })));
    expect(await code(run(t, { assertPublic }))).toBe('headless_unavailable');
  });

  it('C18: an endless body is cut at the wire cap and the socket destroyed', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const destroy = vi.fn();
    const r: HeadlessTransportResponse = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: (async function* () {
        for (;;) {
          pulled++;
          yield chunk;
          if (pulled > 100) return; // safety net: the client must stop long before
        }
      })(),
      destroy,
    };
    expect(await code(run(stub(r)))).toBe('headless_unavailable');
    expect(pulled * chunk.length).toBeLessThanOrEqual(MAX_RENDER_WIRE + chunk.length);
    expect(pulled).toBeLessThan(20);
    expect(destroy).toHaveBeenCalled();
  });

  it('C18: an oversize declared content-length is refused without reading', async () => {
    const r = resp(200, okBody(), {
      'content-type': 'application/json',
      'content-length': String(MAX_RENDER_WIRE + 1),
    });
    expect(await code(run(stub(r)))).toBe('headless_unavailable');
    expect(r.destroy).toHaveBeenCalled();
  });

  it('an endless error body is capped too', async () => {
    const chunk = new Uint8Array(8 * 1024).fill(97);
    let pulled = 0;
    const r: HeadlessTransportResponse = {
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: (async function* () {
        for (;;) {
          pulled++;
          yield chunk;
          if (pulled > 1000) return;
        }
      })(),
      destroy: vi.fn(),
    };
    expect(await code(run(stub(r)))).toBe('headless_unavailable');
    expect(pulled).toBeLessThan(10);
  });
});

describe('headless client: timeout and concurrency', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a slow-drip sidecar is cut at the client timeout', async () => {
    const r: HeadlessTransportResponse = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: (async function* () {
        for (;;) {
          await new Promise((res) => setTimeout(res, 1000));
          yield enc.encode(' ');
        }
      })(),
      destroy: vi.fn(),
    };
    const p = code(run(stub(r)));
    await vi.advanceTimersByTimeAsync(35_001);
    expect(await p).toBe('headless_unavailable');
    expect(r.destroy).toHaveBeenCalled();
  });

  it('a second concurrent render is refused immediately (semaphore of 1)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: HeadlessTransport = async () => {
      await gate;
      return resp(200, okBody());
    };
    const first = run(slow);
    await vi.advanceTimersByTimeAsync(0);
    expect(await code(run(stub(resp(200, okBody()))))).toBe('headless_unavailable');
    release();
    await expect(first).resolves.toMatchObject({ status: 200 });
    // slot is free again
    await expect(run(stub(resp(200, okBody())))).resolves.toBeDefined();
  });
});

describe('headless client: pre-check and disabled', () => {
  it('a private entered URL fails with private_address and never reaches the sidecar', async () => {
    const t = stub(resp(200, okBody()));
    const assertPublic = vi.fn(async () => {
      throw new ImportError('private_address');
    });
    expect(await code(run(t, { assertPublic }))).toBe('private_address');
    expect(t).not.toHaveBeenCalled();
  });

  it('default pre-check uses the safe-fetch policy', async () => {
    const t = stub(resp(200, okBody()));
    const e = await code(renderPage('http://127.0.0.1/x', CONFIG, { transport: t }));
    expect(e).toBe('private_address');
    expect(t).not.toHaveBeenCalled();
  });

  it('unset config: disabled, zero transport calls', async () => {
    expect(isHeadlessEnabled(null)).toBe(false);
    expect(isHeadlessEnabled(undefined)).toBe(false);
    expect(isHeadlessEnabled(CONFIG)).toBe(true);
    const t = stub(resp(200, okBody()));
    const h = createHeadless(null, { transport: t });
    expect(h.enabled).toBe(false);
    expect(await code(h.render('https://example.com/'))).toBe('headless_unavailable');
    expect(t).not.toHaveBeenCalled();
  });
});

describe('headless client: fake sidecar over real http', () => {
  it('talks to a local fake sidecar with the default transport', async () => {
    const http = await import('node:http');
    let seen: { auth?: string; body?: string; path?: string } = {};
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen = { auth: req.headers.authorization, body, path: req.url };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(okBody({ warnings: 1 })));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      vi.useRealTimers();
      const r = await renderPage(
        'https://example.com/r',
        { url: `http://127.0.0.1:${port}`, token: TOKEN, timeoutMs: 5000 },
        { assertPublic: publicOk },
      );
      expect(r.html).toBe('<html>ok</html>');
      expect(seen.path).toBe('/render');
      expect(seen.auth).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(seen.body!)).toEqual({ url: 'https://example.com/r' });
    } finally {
      srv.close();
    }
  });

  it('a sidecar that is down -> headless_unavailable', async () => {
    expect(
      await code(
        renderPage(
          'https://example.com/r',
          { url: 'http://127.0.0.1:1', timeoutMs: 2000 },
          { assertPublic: publicOk },
        ),
      ),
    ).toBe('headless_unavailable');
  });
});
