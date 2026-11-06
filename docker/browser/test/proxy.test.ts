// Proxy unit tests (T3): real sockets on loopback, injected resolver and connector, no
// Chromium and no Docker. "Public" in these tests means "allowed by the test-only seam".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  createJobProxy,
  canonicalHost,
  parseConnectTarget,
  headersSuspicious,
  type Addr,
  type Connector,
  type JobProxy,
  type ProxyOptions,
} from '../src/proxy.ts';
import { listener, raw, status } from './helpers.ts';

async function withProxy(
  opts: Partial<ProxyOptions>,
  fn: (p: JobProxy) => Promise<void>,
): Promise<void> {
  const p = await createJobProxy({ maxBytes: 1 << 20, maxRequests: 100, ...opts });
  try {
    await fn(p);
  } finally {
    await p.close();
  }
}
const get = (p: JobProxy, url: string, host?: string) =>
  raw(
    p.port,
    `GET ${url} HTTP/1.1\r\nHost: ${host ?? new URL(url).host}\r\nConnection: close\r\n\r\n`,
  );

test('canonicalHost normalizes IP literal tricks and rejects junk', () => {
  assert.equal(canonicalHost('2130706433'), '127.0.0.1');
  assert.equal(canonicalHost('0x7f.1'), '127.0.0.1');
  assert.equal(canonicalHost('127.1'), '127.0.0.1');
  assert.equal(canonicalHost('Example.COM.'), 'example.com');
  for (const bad of ['', 'a b', 'user@h', 'h%25eth0', 'h/x', 'h\r\n', 'h:80', 'h\0']) {
    assert.equal(canonicalHost(bad), null, JSON.stringify(bad));
  }
});

test('R10: CONNECT authority must be exactly host:443', () => {
  assert.deepEqual(parseConnectTarget('example.com:443'), { host: 'example.com', port: 443 });
  assert.deepEqual(parseConnectTarget('[2001:4860::1]:443'), { host: '[2001:4860::1]', port: 443 });
  for (const bad of [
    'example.com:22',
    'example.com:80',
    'example.com:0443',
    'example.com:443abc',
    'example.com:4430',
    'u:p@example.com:443',
    ':443',
    'example.com',
    '[::1%25eth0]:443',
    'a b:443',
  ]) {
    assert.equal(parseConnectTarget(bad), null, bad);
  }
});

test('R9: header smuggling shapes are suspicious', () => {
  assert.equal(headersSuspicious(['Host', 'a', 'Accept', '*/*']), false);
  assert.equal(headersSuspicious(['Content-Length', '1', 'Transfer-Encoding', 'chunked']), true);
  assert.equal(headersSuspicious(['Content-Length', '1', 'content-length', '1']), true);
  assert.equal(headersSuspicious(['Content-Length', '+1']), true);
  assert.equal(headersSuspicious(['X-A', 'a\r\nb']), true);
  assert.equal(headersSuspicious(['X-A', 'a\0b']), true);
  assert.equal(headersSuspicious(['X A', 'a']), true);
});

const BLOCKED_TARGETS = [
  'http://127.0.0.1/secret',
  'http://localhost/',
  'http://[::1]/',
  'http://0.0.0.0/',
  'http://2130706433/',
  'http://0x7f.1/',
  'http://127.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.1.2.3/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://[::ffff:127.0.0.1]/',
  'http://[fd00::1]/',
  'http://[64:ff9b::7f00:1]/',
  'http://[2002:7f00:1::]/',
  'http://metadata.google.internal/',
];

test('C1/C11: blocked literals and names get 403 and never reach the connector', async () => {
  await withProxy({}, async (p) => {
    for (const t of BLOCKED_TARGETS) {
      assert.equal(status(await get(p, t)), 403, t);
    }
    assert.equal(p.stats.connects, 0);
    assert.equal(p.stats.blockedPrivate, BLOCKED_TARGETS.length);
  });
});

test('C11: hostnames resolving private (nip.io style, Docker names) are refused with zero connects', async () => {
  const l = await listener();
  try {
    const resolve = async (h: string): Promise<Addr[]> =>
      h === 'app' ? [{ address: '172.18.0.2', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
    await withProxy({ resolve, testOverrides: { allowPorts: [l.port] } }, async (p) => {
      for (const h of ['127.0.0.1.nip.io', 'app', 'browser', 'xn--80ak6aa92e.example']) {
        assert.equal(status(await get(p, `http://${h}:${l.port}/`)), 403, h);
      }
      assert.equal(p.stats.connects, 0);
    });
    assert.equal(l.state.connections, 0);
  } finally {
    await l.close();
  }
});

test('C4: DNS rebinding, one lookup per host, later answers are never used', async () => {
  const l = await listener();
  try {
    let calls = 0;
    const resolve = async (): Promise<Addr[]> =>
      ++calls === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.0.0.5', family: 4 }];
    await withProxy(
      {
        resolve,
        testOverrides: { allowAddress: (ip) => ip === '127.0.0.1', allowPorts: [l.port] },
      },
      async (p) => {
        const url = `http://rebind.example:${l.port}/x`;
        assert.equal(status(await get(p, url)), 200);
        assert.equal(status(await get(p, url)), 200);
        assert.equal(status(await get(p, url)), 200);
        assert.equal(calls, 1);
        assert.equal(p.stats.resolves.get('rebind.example'), 1);
      },
    );
    assert.equal(l.state.connections, 3);
  } finally {
    await l.close();
  }
});

test('C4: mixed public+private answer is rejected as a whole', async () => {
  const l = await listener();
  try {
    const resolve = async (): Promise<Addr[]> => [
      { address: '127.0.0.1', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    await withProxy(
      {
        resolve,
        testOverrides: { allowAddress: (ip) => ip === '127.0.0.1', allowPorts: [l.port] },
      },
      async (p) => {
        assert.equal(status(await get(p, `http://mixed.example:${l.port}/`)), 403);
        assert.equal(p.stats.connects, 0);
      },
    );
    assert.equal(l.state.connections, 0);
  } finally {
    await l.close();
  }
});

test('R4 rebinding failure is cached: a failed lookup is not retried either', async () => {
  let calls = 0;
  const resolve = async (): Promise<Addr[]> => {
    calls++;
    throw new Error('SERVFAIL');
  };
  await withProxy({ resolve }, async (p) => {
    assert.equal(status(await get(p, 'http://flaky.example/')), 502);
    assert.equal(status(await get(p, 'http://flaky.example/')), 502);
    assert.equal(calls, 1);
  });
});

test('m9: connect error on the first validated address tries the next one', async () => {
  const l = await listener();
  try {
    const tried: string[] = [];
    const connect: Connector = async (addr) => {
      tried.push(addr.address);
      if (addr.address === '203.0.113.1') {
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      }
      return net.connect(l.port, '127.0.0.1');
    };
    const resolve = async (): Promise<Addr[]> => [
      { address: '203.0.113.1', family: 4 },
      { address: '203.0.113.2', family: 4 },
    ];
    await withProxy(
      { resolve, connect, testOverrides: { allowAddress: () => true, allowPorts: [l.port] } },
      async (p) => {
        assert.equal(status(await get(p, `http://two.example:${l.port}/`)), 200);
        assert.deepEqual(tried, ['203.0.113.1', '203.0.113.2']);
        assert.equal(p.stats.resolves.get('two.example'), 1);
      },
    );
  } finally {
    await l.close();
  }
});

test('m9: all addresses refusing gives 502; a non-connect error does not fall through', async () => {
  const resolve = async (): Promise<Addr[]> => [
    { address: '203.0.113.1', family: 4 },
    { address: '203.0.113.2', family: 4 },
  ];
  const ov = { allowAddress: () => true };
  let tried = 0;
  await withProxy(
    {
      resolve,
      testOverrides: ov,
      connect: async () => {
        tried++;
        throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
      },
    },
    async (p) => {
      assert.equal(status(await get(p, 'http://down.example/')), 502);
      assert.equal(tried, 2);
    },
  );
  tried = 0;
  await withProxy(
    {
      resolve,
      testOverrides: ov,
      connect: async () => {
        tried++;
        throw Object.assign(new Error('x'), { code: 'EACCES' });
      },
    },
    async (p) => {
      assert.equal(status(await get(p, 'http://eacces.example/')), 502);
      assert.equal(tried, 1);
    },
  );
});

test('C19: malformed or ambiguous proxy requests are refused before any upstream contact', async () => {
  const l = await listener();
  try {
    const ov = { allowAddress: () => true, allowPorts: [l.port] };
    const resolve = async (): Promise<Addr[]> => [{ address: '127.0.0.1', family: 4 }];
    await withProxy({ resolve, testOverrides: ov }, async (p) => {
      const h = `pub.example:${l.port}`;
      const abs = `http://${h}/`;
      const cases: [string, string][] = [
        ['origin-form', `GET / HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['Host mismatch', `GET ${abs} HTTP/1.1\r\nHost: evil.example\r\n\r\n`],
        [
          'CL+TE',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
        ],
        [
          'duplicate CL',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n`,
        ],
        ['non-numeric CL', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: abc\r\n\r\n`],
        ['bare LF target', `GET ${abs}\x01x HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['NUL in header', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nX-A: a\0b\r\n\r\n`],
        ['obs-fold', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nX-A: a\r\n  folded\r\n\r\n`],
        [
          'Upgrade',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        ],
        ['userinfo', `GET http://u:p@${h}/ HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['https absolute', `GET https://${h}/ HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['POST', `POST ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 0\r\n\r\n`],
        ['port 22', `GET http://pub.example:22/ HTTP/1.1\r\nHost: pub.example:22\r\n\r\n`],
      ];
      for (const [name, text] of cases) {
        const code = status(await raw(p.port, text));
        assert.ok(code === 400 || code === 405 || code === 0, `${name}: got ${code}`);
      }
      assert.equal(p.stats.connects, 0, 'nothing reached the connector');
    });
    assert.equal(l.state.connections, 0);
    // Control: a clean request through the same setup works.
    await withProxy({ resolve, testOverrides: ov }, async (p) => {
      assert.equal(status(await get(p, `http://pub.example:${l.port}/`)), 200);
      assert.match(l.state.received.join(''), /^GET \/ HTTP\/1\.1\r\n/);
      assert.doesNotMatch(l.state.received.join(''), /proxy-|x-forwarded|via:/i);
    });
  } finally {
    await l.close();
  }
});

test('C20: CONNECT abuse is refused, caps hold, socket errors do not crash the proxy', async () => {
  await withProxy({ maxTunnels: 2, maxBytes: 64 }, async (p) => {
    for (const t of [
      'example.com:22',
      'example.com:80',
      'example.com:0443',
      'u:p@example.com:443',
      ':443',
      'example.com',
    ]) {
      const r = await raw(p.port, `CONNECT ${t} HTTP/1.1\r\nHost: ${t}\r\n\r\n`);
      assert.equal(status(r), 400, t);
    }
    for (const t of ['127.0.0.1:443', 'localhost:443', '[::1]:443', '169.254.169.254:443']) {
      const r = await raw(p.port, `CONNECT ${t} HTTP/1.1\r\nHost: ${t}\r\n\r\n`);
      assert.equal(status(r), 403, t);
    }
    assert.equal(p.stats.connects, 0);
    // Still alive after the abuse, and a client that vanishes mid-CONNECT is harmless.
    const s = net.connect(p.port, '127.0.0.1');
    s.write('CONNECT example.com:443 HTTP/1.1\r\n');
    s.destroy();
    assert.equal(status(await raw(p.port, 'GET / HTTP/1.1\r\nHost: x\r\n\r\n')), 400);
  });
});

test('C20: tunnel works through the connector, counts bytes and is cut at the byte cap', async () => {
  const echo = net.createServer((s) => {
    s.on('error', () => {});
    s.pipe(s);
  });
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
  const port = (echo.address() as net.AddressInfo).port;
  try {
    await withProxy(
      {
        maxBytes: 256,
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const s = net.connect(p.port, '127.0.0.1');
        s.on('error', () => {});
        let got = '';
        s.on('data', (d) => (got += d.toString('latin1')));
        s.write('CONNECT pub.example:443 HTTP/1.1\r\nHost: pub.example:443\r\n\r\n');
        await new Promise((r) => setTimeout(r, 200));
        assert.match(got, /^HTTP\/1\.1 200 /);
        s.write('hello');
        await new Promise((r) => setTimeout(r, 200));
        assert.match(got, /hello$/);
        s.write(Buffer.alloc(600, 97));
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(p.stats.overBytes, true);
        assert.equal(s.destroyed, true, 'tunnel closed at the byte cap');
      },
    );
  } finally {
    echo.close();
  }
});

test('R10: request cap per job', async () => {
  await withProxy(
    {
      maxRequests: 2,
      resolve: async () => [{ address: '203.0.113.9', family: 4 }],
      testOverrides: { allowAddress: () => true },
      connect: async () => {
        throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
      },
    },
    async (p) => {
      assert.equal(status(await get(p, 'http://a.example/')), 502);
      assert.equal(status(await get(p, 'http://b.example/')), 502);
      assert.equal(status(await get(p, 'http://c.example/')), 429);
      assert.equal(p.stats.overRequests, true);
    },
  );
});
