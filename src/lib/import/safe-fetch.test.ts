import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportError, type ImportErrorCode } from './errors';
import {
  safeFetch,
  type Resolver,
  type SafeFetchOptions,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './safe-fetch';

const enc = new TextEncoder();
const PUBLIC = '93.184.216.34';

function page(
  body: string | Uint8Array,
  extra: Partial<TransportResponse> = {},
): TransportResponse {
  const bytes = typeof body === 'string' ? enc.encode(body) : body;
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: (async function* () {
      yield bytes;
    })(),
    ...extra,
  };
}
const redirect = (location: string, status = 302): TransportResponse => ({
  status,
  headers: { location },
  body: (async function* () {})(),
});

function rig(
  responses: TransportResponse[] | ((req: TransportRequest, n: number) => TransportResponse),
  dns: Record<string, string[]> = {},
) {
  let n = 0;
  const calls: TransportRequest[] = [];
  const transport: Transport = vi.fn(async (req) => {
    calls.push(req);
    const r = typeof responses === 'function' ? responses(req, n) : responses[n];
    n++;
    if (!r) throw new Error('unexpected extra request');
    return r;
  });
  const resolve: Resolver = vi.fn(async (h: string) =>
    (dns[h] ?? [PUBLIC]).map(
      (address) => ({ address, family: address.includes(':') ? 6 : 4 }) as const,
    ),
  );
  return { transport, resolve, calls, opts: { transport, resolve } satisfies SafeFetchOptions };
}

async function code(p: Promise<unknown>): Promise<ImportErrorCode | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ImportError) return e.code;
    throw e;
  }
}

afterEach(() => vi.useRealTimers());

describe('safeFetch happy path', () => {
  it('returns body, final url, sends custom UA and pins the resolved IP', async () => {
    const r = rig([page('<html>hi</html>')]);
    const out = await safeFetch('https://example.com/a?b=1#frag', {
      ...r.opts,
      userAgent: 'CellarBot/9',
    });
    expect(Buffer.from(out.body).toString()).toBe('<html>hi</html>');
    expect(out.finalUrl).toBe('https://example.com/a?b=1');
    expect(r.calls[0]!.ip).toBe(PUBLIC);
    expect(r.calls[0]!.headers['User-Agent']).toBe('CellarBot/9');
  });

  it('accepts default ports explicitly', async () => {
    const r = rig([page('x')]);
    expect(await code(safeFetch('https://example.com:443/', r.opts))).toBe('ok');
  });
});

describe('SSRF: blocked targets never reach the transport', () => {
  const invalid = [
    'file:///etc/passwd',
    'data:text/html,hi',
    'javascript:alert(1)',
    'ftp://example.com/',
    'gopher://example.com/',
    'http://evil@127.0.0.1/',
    'http://user:pw@example.com/',
    'http://example.com:8080/',
    'http://example.com:22/',
    'not a url',
    '',
  ];
  it.each(invalid)('invalid_url: %j', async (u) => {
    const r = rig([page('x')]);
    expect(await code(safeFetch(u, r.opts))).toBe('invalid_url');
    expect(r.transport).not.toHaveBeenCalled();
  });

  const priv = [
    'http://2130706433/', // decimal
    'http://0177.0.0.1/', // octal
    'http://0x7f.1/', // hex + short
    'http://0x7f000001/',
    'http://127.1/',
    'http://0.0.0.0/',
    'http://0/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[::]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/',
    'http://localhost/',
    'http://foo.localhost/',
    'http://LOCALHOST./',
    'http://10.0.0.5/',
    'http://192.168.0.1/',
    'http://172.16.0.1/',
    'http://100.64.0.1/',
  ];
  it.each(priv)('private_address: %s', async (u) => {
    const r = rig([page('x')]);
    expect(await code(safeFetch(u, r.opts))).toBe('private_address');
    expect(r.transport).not.toHaveBeenCalled();
  });

  it('rejects a hostname with a mix of public and private A records', async () => {
    const r = rig([page('x')], { 'mixed.example': [PUBLIC, '10.0.0.7'] });
    expect(await code(safeFetch('https://mixed.example/', r.opts))).toBe('private_address');
    expect(r.transport).not.toHaveBeenCalled();
  });

  it('rejects when a private AAAA record sits behind a public A record', async () => {
    const r = rig([page('x')], { 'v6.example': [PUBLIC, '::1'] });
    expect(await code(safeFetch('https://v6.example/', r.opts))).toBe('private_address');
    expect(r.transport).not.toHaveBeenCalled();
  });

  it('DNS rebinding: resolves once per hop and connects to the validated IP only', async () => {
    let lookups = 0;
    const resolve: Resolver = vi.fn(async () => {
      lookups++;
      return [{ address: lookups === 1 ? PUBLIC : '127.0.0.1', family: 4 as const }];
    });
    const r = rig([page('x')]);
    await safeFetch('https://rebind.example/', { transport: r.transport, resolve });
    expect(lookups).toBe(1);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.ip).toBe(PUBLIC);
  });

  it('DNS rebinding across a redirect: second hop resolving private is refused', async () => {
    let lookups = 0;
    const resolve: Resolver = async () => {
      lookups++;
      return [{ address: lookups === 1 ? PUBLIC : '127.0.0.1', family: 4 as const }];
    };
    const r = rig([redirect('https://rebind.example/next'), page('x')]);
    expect(
      await code(safeFetch('https://rebind.example/', { transport: r.transport, resolve })),
    ).toBe('private_address');
    expect(r.transport).toHaveBeenCalledTimes(1);
  });

  it('resolver failure maps to fetch_failed without leaking the error', async () => {
    const r = rig([page('x')]);
    const resolve: Resolver = async () => {
      throw new Error('ENOTFOUND secret.internal.corp 10.1.2.3');
    };
    const err = await safeFetch('https://nx.example/', { transport: r.transport, resolve }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe('fetch_failed');
    expect(err.message).not.toMatch(/10\.1\.2\.3|secret/);
  });
});

describe('SSRF: redirects', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://localhost/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
  ])('redirect to %s is refused, transport called once', async (target) => {
    const r = rig([redirect(target), page('SECRET')]);
    expect(await code(safeFetch('https://example.com/', r.opts))).toBe('private_address');
    expect(r.transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com/',
    'data:text/html,x',
    'http://u@example.com/',
  ])('redirect to %s is refused as invalid_url', async (target) => {
    const r = rig([redirect(target), page('x')]);
    expect(await code(safeFetch('https://example.com/', r.opts))).toBe('invalid_url');
    expect(r.transport).toHaveBeenCalledTimes(1);
  });

  it('redirect to a non-standard port is refused', async () => {
    const r = rig([redirect('http://example.com:6379/'), page('x')]);
    expect(await code(safeFetch('https://example.com/', r.opts))).toBe('invalid_url');
  });

  it('private IP literal after a public hop is refused', async () => {
    const r = rig([redirect('https://b.example/'), redirect('http://10.0.0.1/'), page('x')]);
    expect(await code(safeFetch('https://a.example/', r.opts))).toBe('private_address');
    expect(r.transport).toHaveBeenCalledTimes(2);
  });

  it('follows relative redirects, up to 5', async () => {
    const r = rig((_req, n) => (n < 5 ? redirect(`/p${n + 1}`) : page('end')));
    const out = await safeFetch('https://example.com/p0', r.opts);
    expect(out.finalUrl).toBe('https://example.com/p5');
    expect(r.calls).toHaveLength(6);
  });

  it('a chain of 6 redirects is rejected', async () => {
    const r = rig((_req, n) => (n < 6 ? redirect(`/p${n + 1}`) : page('end')));
    expect(await code(safeFetch('https://example.com/p0', r.opts))).toBe('fetch_failed');
    expect(r.calls).toHaveLength(6);
  });

  it('redirect without Location fails', async () => {
    const r = rig([{ status: 302, headers: {}, body: (async function* () {})() }]);
    expect(await code(safeFetch('https://example.com/', r.opts))).toBe('fetch_failed');
  });

  it('User-Agent is sent on every hop', async () => {
    const r = rig([redirect('/b'), redirect('/c'), page('x')]);
    await safeFetch('https://example.com/a', { ...r.opts, userAgent: 'UA-test' });
    expect(r.calls.map((c) => c.headers['User-Agent'])).toEqual(['UA-test', 'UA-test', 'UA-test']);
  });
});

describe('status and content type mapping', () => {
  it.each([
    [403, 'blocked'],
    [429, 'blocked'],
    [401, 'blocked'],
    [404, 'fetch_failed'],
    [500, 'fetch_failed'],
    [503, 'fetch_failed'],
  ] as const)('HTTP %i -> %s', async (status, expected) => {
    const r = rig([
      { status, headers: { 'content-type': 'text/html' }, body: (async function* () {})() },
    ]);
    expect(await code(safeFetch('https://example.com/', r.opts))).toBe(expected);
  });

  it('rejects non-HTML content for page fetches', async () => {
    const r = rig([page('{}', { headers: { 'content-type': 'application/json' } })]);
    expect(await code(safeFetch('https://example.com/', r.opts))).toBe('fetch_failed');
  });

  it('rejects svg and html for image fetches, accepts png', async () => {
    const svg = rig([page('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })]);
    expect(await code(safeFetch('https://example.com/i', { ...svg.opts, accept: 'image' }))).toBe(
      'fetch_failed',
    );
    const html = rig([page('x')]);
    expect(await code(safeFetch('https://example.com/i', { ...html.opts, accept: 'image' }))).toBe(
      'fetch_failed',
    );
    const png = rig([page('x', { headers: { 'content-type': 'image/png' } })]);
    expect(await code(safeFetch('https://example.com/i', { ...png.opts, accept: 'image' }))).toBe(
      'ok',
    );
  });
});

describe('size cap', () => {
  const big = (n: number) => new Uint8Array(n).fill(65);

  it('rejects when streamed bytes exceed the cap with no Content-Length', async () => {
    const r = rig([
      {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: (async function* () {
          yield big(60);
          yield big(60);
        })(),
      },
    ]);
    expect(await code(safeFetch('https://example.com/', { ...r.opts, maxBytes: 100 }))).toBe(
      'too_large',
    );
  });

  it('ignores a lying Content-Length and counts streamed bytes', async () => {
    const r = rig([
      page(big(500), { headers: { 'content-type': 'text/html', 'content-length': '10' } }),
    ]);
    expect(await code(safeFetch('https://example.com/', { ...r.opts, maxBytes: 100 }))).toBe(
      'too_large',
    );
  });

  it('rejects early on a large declared Content-Length', async () => {
    const r = rig([
      page('x', { headers: { 'content-type': 'text/html', 'content-length': '999999999' } }),
    ]);
    expect(await code(safeFetch('https://example.com/', r.opts))).toBe('too_large');
  });

  it('accepts exactly the cap', async () => {
    const r = rig([page(big(100))]);
    expect(await code(safeFetch('https://example.com/', { ...r.opts, maxBytes: 100 }))).toBe('ok');
  });

  it('stops a gzip bomb by decoded size', async () => {
    const bomb = gzipSync(big(2_000_000));
    expect(bomb.length).toBeLessThan(10_000);
    const r = rig([
      page(bomb, { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }),
    ]);
    expect(await code(safeFetch('https://example.com/', { ...r.opts, maxBytes: 100_000 }))).toBe(
      'too_large',
    );
  });

  it('decodes gzip within the cap', async () => {
    const r = rig([
      page(gzipSync(Buffer.from('<html>ok</html>')), {
        headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      }),
    ]);
    const out = await safeFetch('https://example.com/', r.opts);
    expect(Buffer.from(out.body).toString()).toBe('<html>ok</html>');
  });

  it('corrupt gzip and unknown encodings map to fetch_failed', async () => {
    const corrupt = rig([
      page('not gzip', { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }),
    ]);
    expect(await code(safeFetch('https://example.com/', corrupt.opts))).toBe('fetch_failed');
    const unknown = rig([
      page('x', { headers: { 'content-type': 'text/html', 'content-encoding': 'compress' } }),
    ]);
    expect(await code(safeFetch('https://example.com/', unknown.opts))).toBe('fetch_failed');
  });
});

describe('timeout', () => {
  it('covers slow headers', async () => {
    vi.useFakeTimers();
    const transport: Transport = () => new Promise(() => {});
    const p = code(
      safeFetch('https://example.com/', {
        transport,
        resolve: async () => [{ address: PUBLIC, family: 4 }],
      }),
    );
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await p).toBe('timeout');
  });

  it('covers a slow body', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    const transport: Transport = async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      destroy,
      body: (async function* () {
        yield enc.encode('partial');
        await new Promise(() => {});
      })(),
    });
    const p = code(
      safeFetch('https://example.com/', {
        transport,
        resolve: async () => [{ address: PUBLIC, family: 4 }],
      }),
    );
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await p).toBe('timeout');
    expect(destroy).toHaveBeenCalled();
  });

  it('is a wall clock across redirects', async () => {
    vi.useFakeTimers();
    let n = 0;
    const transport: Transport = async () => {
      n++;
      await new Promise((r) => setTimeout(r, 4000));
      return n < 5 ? redirect(`/${n}`) : page('x');
    };
    const p = code(
      safeFetch('https://example.com/', {
        transport,
        resolve: async () => [{ address: PUBLIC, family: 4 }],
      }),
    );
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await p).toBe('timeout');
  });
});

describe('connect fallback across resolved addresses', () => {
  const A = '93.184.216.34';
  const B = '93.184.216.35';
  const refuse = (code = 'ECONNREFUSED') => Object.assign(new Error(`connect ${code}`), { code });
  const multi = (): Resolver =>
    vi.fn(async () => [
      { address: A, family: 4 as const },
      { address: B, family: 4 as const },
    ]);

  it('tries the second address when the first refuses, without re-resolving', async () => {
    const seen: string[] = [];
    const transport: Transport = async (req) => {
      seen.push(req.ip);
      if (req.ip === A) throw refuse();
      return page('ok');
    };
    const resolve = multi();
    const res = await safeFetch('https://multi.example/', { transport, resolve });
    expect(seen).toEqual([A, B]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(res.body)).toBe('ok');
  });

  it.each(['ETIMEDOUT', 'EHOSTUNREACH'])('falls back on %s', async (c) => {
    const transport: Transport = async (req) => {
      if (req.ip === A) throw refuse(c);
      return page('ok');
    };
    expect(await code(safeFetch('https://multi.example/', { transport, resolve: multi() }))).toBe(
      'ok',
    );
  });

  it('all addresses refusing maps to fetch_failed', async () => {
    const transport = vi.fn<Transport>(async () => {
      throw refuse();
    });
    expect(await code(safeFetch('https://multi.example/', { transport, resolve: multi() }))).toBe(
      'fetch_failed',
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('does not fall back on non-connect errors', async () => {
    const transport = vi.fn<Transport>(async () => {
      throw refuse('ECONNRESET');
    });
    expect(await code(safeFetch('https://multi.example/', { transport, resolve: multi() }))).toBe(
      'fetch_failed',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('never tries a private address, even as a fallback', async () => {
    const transport = vi.fn<Transport>(async () => {
      throw refuse();
    });
    const resolve: Resolver = async () => [
      { address: A, family: 4 },
      { address: '10.0.0.7', family: 4 },
    ];
    expect(await code(safeFetch('https://mixed.example/', { transport, resolve }))).toBe(
      'private_address',
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('total time stays bounded by the shared deadline', async () => {
    vi.useFakeTimers();
    const transport: Transport = async () => {
      await new Promise((r) => setTimeout(r, 6000));
      throw refuse('ETIMEDOUT');
    };
    const p = code(safeFetch('https://multi.example/', { transport, resolve: multi() }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toBe('timeout');
  });

  it('removes the per-hop abort listener when the hop completes', async () => {
    const add = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    const r = rig([page('x')]);
    await safeFetch('https://example.com/', r.opts);
    const added = add.mock.calls.filter((c) => c[0] === 'abort').map((c) => c[1]);
    expect(added.length).toBeGreaterThan(0);
    for (const fn of added) {
      expect(remove.mock.calls.some((c) => c[0] === 'abort' && c[1] === fn)).toBe(true);
    }
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('error hygiene', () => {
  it('errors never carry addresses, bodies or internal text', async () => {
    const r = rig([
      page('SECRET-BODY', {
        headers: { 'content-type': 'text/html', 'content-length': '99999999' },
      }),
    ]);
    const err = await safeFetch('https://example.com/', r.opts).catch((e) => e);
    expect(err.message).toBe('import_error:too_large');
    const priv = await safeFetch('http://192.168.7.7/', r.opts).catch((e) => e);
    expect(priv.message).toBe('import_error:private_address');
    expect(priv.message).not.toContain('192.168');
  });

  it('transport failure maps to fetch_failed with fixed message', async () => {
    const transport: Transport = async () => {
      throw new Error('ECONNRESET to 93.184.216.34');
    };
    const err = await safeFetch('https://example.com/', {
      transport,
      resolve: async () => [{ address: PUBLIC, family: 4 }],
    }).catch((e) => e);
    expect(err.code).toBe('fetch_failed');
    expect(err.message).not.toContain('93.184');
  });
});

describe('allowLocal seam (non-production fixtures only)', () => {
  it('permits loopback and custom ports only when explicitly enabled', async () => {
    const r = rig([page('fixture')]);
    expect(
      await code(safeFetch('http://127.0.0.1:4010/a.html', { ...r.opts, allowLocal: true })),
    ).toBe('ok');
    const off = rig([page('x')]);
    expect(await code(safeFetch('http://127.0.0.1:4010/a.html', off.opts))).toBe('invalid_url');
    expect(off.transport).not.toHaveBeenCalled();
  });
});

describe('default transport (real socket on loopback, allowLocal)', () => {
  it('connects to the pinned IP while keeping the Host header', async () => {
    const { createServer } = await import('node:http');
    let seenHost = '';
    let seenUa = '';
    const srv = createServer((req, res) => {
      seenHost = req.headers.host ?? '';
      seenUa = req.headers['user-agent'] ?? '';
      res.setHeader('content-type', 'text/html');
      res.end('<html>real</html>');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      const out = await safeFetch(`http://pinned.test:${port}/x`, {
        allowLocal: true,
        userAgent: 'UA-real',
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      });
      expect(Buffer.from(out.body).toString()).toBe('<html>real</html>');
      expect(seenHost).toBe(`pinned.test:${port}`);
      expect(seenUa).toBe('UA-real');
    } finally {
      srv.close();
    }
  });
});
