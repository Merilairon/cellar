// T9 proxy abuse matrix (C19 parsing, C20 CONNECT, C3/C14 upgrade, C11 name tricks).
// Real sockets on loopback, injected resolver and connector, no Chromium, no Docker.
// Every case asserts the refusal AND that the protected listener saw zero connections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createJobProxy, type Addr, type JobProxy, type ProxyOptions } from '../src/proxy.ts';
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const echoServer = async (onConn?: (s: net.Socket) => void) => {
  const state = { connections: 0 };
  const server = net.createServer((s) => {
    state.connections++;
    s.on('error', () => {});
    if (onConn) onConn(s);
    else s.pipe(s);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    state,
    port: (server.address() as net.AddressInfo).port,
    close: () => {
      server.close();
      (server as net.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    },
  };
};

/** Opens a CONNECT tunnel and resolves with the socket plus what was read so far. */
async function tunnel(proxyPort: number, target = 'pub.example:443') {
  const s = net.connect(proxyPort, '127.0.0.1');
  s.on('error', () => {});
  const seen = { text: '' };
  s.on('data', (d) => (seen.text += d.toString('latin1')));
  s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  await pause(150);
  return { s, seen };
}

// ---------------------------------------------------------------------------------------------
// C19: request parsing
// ---------------------------------------------------------------------------------------------

test('C19: smuggling and parser-differential shapes never reach the upstream listener', async () => {
  const l = await listener();
  try {
    const ov = { allowAddress: () => true, allowPorts: [l.port] };
    const resolve = async (): Promise<Addr[]> => [{ address: '127.0.0.1', family: 4 }];
    await withProxy({ resolve, testOverrides: ov }, async (p) => {
      const h = `pub.example:${l.port}`;
      const abs = `http://${h}/`;
      const smuggled = `GET http://${h}/smuggled HTTP/1.1\r\nHost: ${h}\r\n\r\n`;
      const cases: [string, string][] = [
        [
          'TE.CL',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nTransfer-Encoding: chunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n${smuggled}`,
        ],
        [
          'CL.TE',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n${smuggled}`,
        ],
        [
          'TE only on GET',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n${smuggled}`,
        ],
        [
          'TE obfuscated (tab)',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nTransfer-Encoding:\tchunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n`,
        ],
        [
          'TE obfuscated (xchunked)',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nTransfer-Encoding: xchunked\r\n\r\n`,
        ],
        [
          'duplicate TE',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: identity\r\n\r\n`,
        ],
        ['CL list', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 4, 4\r\n\r\nabcd`],
        ['CL negative', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: -1\r\n\r\n`],
        ['CL plus sign', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: +4\r\n\r\nabcd`],
        ['CL hex', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 0x4\r\n\r\nabcd`],
        [
          'CL with body on GET',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 4\r\n\r\nabcd`,
        ],
        [
          'CL huge',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 99999999999999999999\r\n\r\n`,
        ],
        ['missing Host', `GET ${abs} HTTP/1.1\r\n\r\n`],
        ['duplicate Host', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nHost: evil.example\r\n\r\n`],
        ['Host with userinfo', `GET ${abs} HTTP/1.1\r\nHost: u:p@${h}\r\n\r\n`],
        ['Host mismatch (port)', `GET ${abs} HTTP/1.1\r\nHost: pub.example:1\r\n\r\n`],
        ['Host mismatch (name)', `GET ${abs} HTTP/1.1\r\nHost: other.example:${l.port}\r\n\r\n`],
        ['origin-form with Host', `GET /smuggled HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['asterisk-form', `OPTIONS * HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['authority-form on GET', `GET ${h} HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['CR in target', `GET ${abs}a\rb HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['LF in target', `GET ${abs}a\nb HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['NUL in target', `GET ${abs}a\0b HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['TAB in target', `GET ${abs}a\tb HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['space in target', `GET ${abs}a b HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['bare CR header terminator', `GET ${abs} HTTP/1.1\r\nHost: ${h}\rX-A: b\r\n\r\n`],
        ['bare LF line endings', `GET ${abs} HTTP/1.1\nHost: ${h}\n\n`],
        ['CR inside header value', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nX-A: a\rb\r\n\r\n`],
        ['NUL in header name', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nX\0A: b\r\n\r\n`],
        ['space in header name', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nX A: b\r\n\r\n`],
        ['space before colon', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length : 0\r\n\r\n`],
        ['obs-fold on Host', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\n evil.example\r\n\r\n`],
        ['obs-fold with tab', `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nX-A: a\r\n\tfolded\r\n\r\n`],
        ['lowercase method', `get ${abs} HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['HTTP/2 preface', `PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n`],
        ['bad version', `GET ${abs} HTTP/9.9\r\nHost: ${h}\r\n\r\n`],
        [
          'Upgrade h2c',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nConnection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\n\r\n`,
        ],
        [
          'Upgrade without Connection',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nUpgrade: websocket\r\n\r\n`,
        ],
        [
          'Connection: upgrade without Upgrade',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nConnection: upgrade\r\n\r\n`,
        ],
        [
          'oversized header block',
          `GET ${abs} HTTP/1.1\r\nHost: ${h}\r\nX-A: ${'a'.repeat(20000)}\r\n\r\n`,
        ],
        ['oversized target', `GET http://${h}/${'a'.repeat(20000)} HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['PUT', `PUT ${abs} HTTP/1.1\r\nHost: ${h}\r\nContent-Length: 0\r\n\r\n`],
        ['TRACE', `TRACE ${abs} HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['userinfo with encoded at', `GET http://u%40x:p@${h}/ HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['backslash authority', `GET http://evil.example\\@${h}/ HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['scheme ftp', `GET ftp://${h}/ HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['scheme ws', `GET ws://${h}/ HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
        ['scheme file', `GET file:///etc/passwd HTTP/1.1\r\nHost: ${h}\r\n\r\n`],
      ];
      for (const [name, text] of cases) {
        const resp = await raw(p.port, text);
        const code = status(resp);
        assert.ok(
          [0, 400, 405, 414, 431].includes(code),
          `${name}: got ${code} (${JSON.stringify(resp.slice(0, 40))})`,
        );
        assert.equal(l.state.connections, 0, `${name}: reached the upstream listener`);
      }
      assert.equal(p.stats.connects, 0, 'nothing reached the connector');
      assert.equal(l.state.received.length, 0);
    });
  } finally {
    await l.close();
  }
});

test('C19: a pipelined second request on the same socket is never served', async () => {
  const l = await listener();
  try {
    const ov = { allowAddress: () => true, allowPorts: [l.port] };
    const resolve = async (): Promise<Addr[]> => [{ address: '127.0.0.1', family: 4 }];
    await withProxy({ resolve, testOverrides: ov }, async (p) => {
      const h = `pub.example:${l.port}`;
      const one = `GET http://${h}/first HTTP/1.1\r\nHost: ${h}\r\n\r\n`;
      const two = `GET http://${h}/second HTTP/1.1\r\nHost: ${h}\r\n\r\n`;
      await raw(p.port, one + two);
      await pause(200);
      const got = l.state.received.join('');
      assert.match(got, /GET \/first /, 'control: the first request is served');
      assert.doesNotMatch(got, /\/second/, 'the pipelined request is not forwarded');
    });
  } finally {
    await l.close();
  }
});

test('C19: hop-by-hop, proxy and forwarding headers are stripped, none added', async () => {
  const l = await listener();
  try {
    const ov = { allowAddress: () => true, allowPorts: [l.port] };
    const resolve = async (): Promise<Addr[]> => [{ address: '127.0.0.1', family: 4 }];
    await withProxy({ resolve, testOverrides: ov }, async (p) => {
      const h = `pub.example:${l.port}`;
      const resp = await raw(
        p.port,
        `GET http://${h}/x HTTP/1.1\r\nHost: ${h}\r\nProxy-Authorization: Basic eDp5\r\nProxy-Connection: keep-alive\r\nX-Forwarded-For: 10.0.0.1\r\nX-Forwarded-Host: evil\r\nForwarded: for=10.0.0.1\r\nVia: 1.1 evil\r\nTE: trailers\r\nKeep-Alive: 300\r\nTrailer: X\r\nX-Keep: yes\r\nConnection: close\r\n\r\n`,
      );
      assert.equal(status(resp), 200);
      const got = l.state.received.join('');
      assert.match(got, /x-keep: yes/i, 'control: ordinary headers pass');
      assert.doesNotMatch(
        got,
        /proxy-|x-forwarded|forwarded:|via:|^te:|keep-alive|trailer:/im,
        'hop-by-hop and proxy headers are not forwarded',
      );
      assert.match(got, /connection: close/i, 'no keep-alive upstream');
    });
  } finally {
    await l.close();
  }
});

test('C19: refusals never reflect the target, the resolver error or a banner', async () => {
  await withProxy(
    {
      resolve: async (host) => {
        if (host === 'boom.example') throw new Error('SECRET-RESOLVER-TEXT 10.9.8.7');
        return [{ address: '10.9.8.7', family: 4 }];
      },
    },
    async (p) => {
      const cases = [
        'GET http://secret-target.example/a HTTP/1.1\r\nHost: secret-target.example\r\n\r\n',
        'GET http://boom.example/a HTTP/1.1\r\nHost: boom.example\r\n\r\n',
        'GET http://127.0.0.1/secret-path HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n',
        'GET http://secret-target.example:22/a HTTP/1.1\r\nHost: secret-target.example:22\r\n\r\n',
        'CONNECT secret-target.example:443 HTTP/1.1\r\nHost: secret-target.example:443\r\n\r\n',
        'CONNECT boom.example:443 HTTP/1.1\r\nHost: boom.example:443\r\n\r\n',
        'GET /secret-path HTTP/1.1\r\nHost: secret-target.example\r\n\r\n',
      ];
      for (const c of cases) {
        const resp = await raw(p.port, c);
        assert.ok(status(resp) >= 400, c);
        assert.doesNotMatch(resp, /secret|boom|10\.9\.8\.7|127\.0\.0\.1|Node|Express/i, c);
        assert.doesNotMatch(resp, /^server:/im, 'no Server banner');
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
// C11: name tricks resolved through the injected resolver
// ---------------------------------------------------------------------------------------------

test('C11: case, trailing dot, punycode, IDN and embedded-IP names that resolve private are refused', async () => {
  const resolved: string[] = [];
  await withProxy(
    {
      resolve: async (host) => {
        resolved.push(host);
        return [{ address: '192.168.0.10', family: 4 }];
      },
    },
    async (p) => {
      const names = [
        'EXAMPLE.COM',
        'example.com.',
        'Example.Com.',
        'xn--e1afmkfd.xn--p1ai', // punycode, resolves private through the double
        '127.0.0.1.nip.io',
        '10.0.0.1.sslip.io',
        'a.b.c.d.e.f.example',
        'app',
        'browser',
        'host.docker.internal',
        'gateway.docker.internal',
      ];
      for (const n of names) {
        const resp = await raw(
          p.port,
          `GET http://${n}/ HTTP/1.1\r\nHost: ${n}\r\nConnection: close\r\n\r\n`,
        );
        assert.equal(status(resp), 403, n);
      }
      // Raw non-ASCII in a request line (Chromium always sends punycode): refused either way.
      for (const n of ['пример.рф', 'ехаmple.com']) {
        const resp = await raw(
          p.port,
          `GET http://${n}/ HTTP/1.1\r\nHost: ${n}\r\nConnection: close\r\n\r\n`,
        );
        assert.ok([400, 403].includes(status(resp)), `${n}: ${status(resp)}`);
      }
      assert.equal(p.stats.connects, 0);
      assert.ok(
        resolved.every((h) => h === h.toLowerCase() && !h.endsWith('.')),
        `resolver only sees canonical names: ${resolved.join(',')}`,
      );
    },
  );
});

test('C11: IP literal spellings and port tricks are refused without a lookup', async () => {
  let lookups = 0;
  await withProxy(
    {
      resolve: async () => {
        lookups++;
        return [{ address: '203.0.113.9', family: 4 }];
      },
    },
    async (p) => {
      for (const h of [
        '[::ffff:127.0.0.1]',
        '[::ffff:7f00:1]',
        '[::127.0.0.1]',
        '[64:ff9b::7f00:1]',
        '[2002:7f00:1::]',
        '[::]',
        '[fd00::1]',
        '[fe80::1]',
        '2130706433',
        '0x7f000001',
        '0177.0.0.1',
        '127.1',
        '0',
        '0.0.0.0',
        '100.64.0.1',
        '198.18.0.1',
        '224.0.0.1',
        '255.255.255.255',
      ]) {
        const resp = await raw(
          p.port,
          `GET http://${h}/ HTTP/1.1\r\nHost: ${h}\r\nConnection: close\r\n\r\n`,
        );
        assert.ok([400, 403].includes(status(resp)), `${h}: ${status(resp)}`);
      }
      // A public name on a non-standard port is a policy refusal, not a connection.
      for (const port of [22, 25, 3000, 3001, 5432, 6379, 8080, 8443]) {
        const h = `example.com:${port}`;
        const resp = await raw(
          p.port,
          `GET http://${h}/ HTTP/1.1\r\nHost: ${h}\r\nConnection: close\r\n\r\n`,
        );
        assert.equal(status(resp), 400, h);
      }
      assert.equal(lookups, 0);
      assert.equal(p.stats.connects, 0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// C20: CONNECT abuse
// ---------------------------------------------------------------------------------------------

test('C20: malformed CONNECT authorities are all refused with zero lookups and connects', async () => {
  let lookups = 0;
  await withProxy(
    {
      resolve: async () => {
        lookups++;
        return [{ address: '203.0.113.9', family: 4 }];
      },
      testOverrides: { allowAddress: () => true },
    },
    async (p) => {
      for (const t of [
        'pub.example:22',
        'pub.example:80',
        'pub.example:8443',
        'pub.example:0443',
        'pub.example:00443',
        'pub.example:+443',
        'pub.example:443abc',
        'pub.example:4430',
        'pub.example:65536',
        'pub.example:-1',
        'pub.example:0x1bb',
        'pub.example:',
        'pub.example',
        ':443',
        '',
        'u@pub.example:443',
        'u:p@pub.example:443',
        'pub.example:443@evil.example:443',
        'pub.example:443:443',
        'pub.example\\evil:443',
        'pub.example/evil:443',
        'pub.example?x:443',
        'pub.example#x:443',
        'pub.%65xample:443',
        '[::1:443',
        '[::1]443',
        '[::1%25eth0]:443',
        '[fe80::1%eth0]:443',
        '[]:443',
        '[::1]:443:443',
        'http://pub.example:443',
        '*',
        '/',
      ]) {
        const resp = await raw(p.port, `CONNECT ${t} HTTP/1.1\r\nHost: ${t}\r\n\r\n`);
        assert.ok([0, 400].includes(status(resp)), `${JSON.stringify(t)}: ${status(resp)}`);
      }
      assert.equal(lookups, 0, 'no DNS for malformed authorities');
      assert.equal(p.stats.connects, 0);
    },
  );
});

test('C20: CONNECT to private, loopback, Docker and proxy-own addresses fails via the guard', async () => {
  await withProxy(
    {
      resolve: async (host) =>
        host === 'app' || host === 'browser'
          ? [{ address: '172.18.0.2', family: 4 }]
          : [{ address: '203.0.113.9', family: 4 }],
    },
    async (p) => {
      for (const t of [
        '127.0.0.1:443',
        'localhost:443',
        '[::1]:443',
        '0.0.0.0:443',
        '[::ffff:127.0.0.1]:443',
        '[::ffff:7f00:1]:443',
        '10.0.0.1:443',
        '172.16.0.1:443',
        '172.17.0.1:443', // default Docker bridge gateway
        '192.168.1.1:443',
        '169.254.169.254:443',
        '2130706433:443',
        '0x7f.1:443',
        '127.1:443',
        'app:443',
        'browser:443',
        'host.docker.internal:443',
      ]) {
        const resp = await raw(p.port, `CONNECT ${t} HTTP/1.1\r\nHost: ${t}\r\n\r\n`);
        assert.equal(status(resp), 403, t);
      }
      // The proxy's own port is not 443, so it dies at the port rule before any lookup.
      const own = `127.0.0.1:${p.port}`;
      assert.equal(
        status(await raw(p.port, `CONNECT ${own} HTTP/1.1\r\nHost: ${own}\r\n\r\n`)),
        400,
      );
      assert.equal(p.stats.connects, 0);
    },
  );
});

test('C20: bytes pipelined behind CONNECT, or a CONNECT with a body, are refused', async () => {
  const l = await listener();
  try {
    await withProxy(
      {
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(l.port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const piggy = await raw(
          p.port,
          'CONNECT pub.example:443 HTTP/1.1\r\nHost: pub.example:443\r\n\r\nGET http://pub.example/smuggled HTTP/1.1\r\nHost: pub.example\r\n\r\n',
        );
        assert.equal(status(piggy), 400);
        const body = await raw(
          p.port,
          'CONNECT pub.example:443 HTTP/1.1\r\nHost: pub.example:443\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\nhello',
        );
        assert.ok([0, 400].includes(status(body)));
        assert.equal(p.stats.connects, 0);
        assert.equal(l.state.connections, 0);
      },
    );
  } finally {
    await l.close();
  }
});

test('C20: the concurrent tunnel cap holds and is released when a tunnel closes', async () => {
  const echo = await echoServer();
  try {
    await withProxy(
      {
        maxTunnels: 2,
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(echo.port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const a = await tunnel(p.port);
        const b = await tunnel(p.port);
        assert.match(a.seen.text, /^HTTP\/1\.1 200 /);
        assert.match(b.seen.text, /^HTTP\/1\.1 200 /);
        const c = await tunnel(p.port);
        assert.equal(status(c.seen.text), 400, 'third concurrent tunnel is refused');
        assert.equal(echo.state.connections, 2, 'the refused tunnel never connected upstream');
        a.s.destroy();
        await pause(200);
        const d = await tunnel(p.port);
        assert.match(d.seen.text, /^HTTP\/1\.1 200 /, 'a freed slot is reusable');
        for (const t of [b, d]) t.s.destroy();
      },
    );
  } finally {
    echo.close();
  }
});

test('C20: the per-job request cap also bounds the number of tunnels', async () => {
  const echo = await echoServer();
  try {
    await withProxy(
      {
        maxRequests: 3,
        maxTunnels: 32,
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(echo.port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const open: net.Socket[] = [];
        for (let i = 0; i < 3; i++) {
          const t = await tunnel(p.port);
          assert.match(t.seen.text, /^HTTP\/1\.1 200 /, `tunnel ${i}`);
          open.push(t.s);
        }
        const over = await tunnel(p.port);
        assert.equal(status(over.seen.text), 429);
        assert.equal(p.stats.overRequests, true);
        assert.equal(echo.state.connections, 3);
        for (const s of open) s.destroy();
      },
    );
  } finally {
    echo.close();
  }
});

test('C20: an idle tunnel is cut after the idle timeout, an active one is not', async () => {
  const echo = await echoServer();
  try {
    await withProxy(
      {
        idleMs: 300,
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(echo.port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const idle = await tunnel(p.port);
        const busy = await tunnel(p.port);
        for (let i = 0; i < 6; i++) {
          busy.s.write('ping');
          await pause(100);
        }
        assert.equal(idle.s.destroyed, true, 'idle tunnel was cut');
        assert.equal(busy.s.destroyed, false, 'active tunnel survives');
        busy.s.destroy();
      },
    );
  } finally {
    echo.close();
  }
});

test('C20: nothing from upstream reaches the client before the 200, and the 200 comes first', async () => {
  const greeter = await echoServer((s) => s.write('SSH-2.0-banner\r\n'));
  try {
    await withProxy(
      {
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(greeter.port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const t = await tunnel(p.port);
        assert.match(t.seen.text, /^HTTP\/1\.1 200 Connection Established\r\n\r\n/);
        t.s.destroy();
      },
    );
  } finally {
    greeter.close();
  }
});

test('C20: upstream resets, upstream errors and client resets do not crash the proxy', async () => {
  const resetter = await echoServer((s) => {
    s.once('data', () => s.resetAndDestroy());
  });
  const erroring = async () => {
    const s = new net.Socket();
    setTimeout(() => s.destroy(Object.assign(new Error('late'), { code: 'ECONNRESET' })), 100);
    return s;
  };
  let mode: 'reset' | 'late-error' = 'reset';
  try {
    await withProxy(
      {
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () =>
          mode === 'reset' ? net.connect(resetter.port, '127.0.0.1') : erroring(),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const uncaught: unknown[] = [];
        const onUncaught = (e: unknown) => uncaught.push(e);
        process.on('uncaughtException', onUncaught);
        try {
          const r = await tunnel(p.port);
          r.s.write('trigger');
          await pause(200);
          assert.equal(r.s.destroyed, true, 'client is cut when upstream resets');
          mode = 'late-error';
          const e = await tunnel(p.port);
          await pause(300);
          e.s.destroy();
          // Client RST mid-tunnel.
          mode = 'reset';
          const c = await tunnel(p.port);
          c.s.resetAndDestroy();
          await pause(200);
        } finally {
          process.off('uncaughtException', onUncaught);
        }
        assert.deepEqual(uncaught, []);
        // Still serving.
        assert.equal(
          status(await raw(p.port, 'GET / HTTP/1.1\r\nHost: x\r\n\r\n')),
          400,
          'proxy still answers',
        );
      },
    );
  } finally {
    resetter.close();
  }
});

test('C20: the byte cap cuts an open tunnel and refuses everything after it', async () => {
  const echo = await echoServer();
  try {
    await withProxy(
      {
        maxBytes: 100,
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(echo.port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const t = await tunnel(p.port);
        t.s.write(Buffer.alloc(400, 97));
        await pause(300);
        assert.equal(t.s.destroyed, true);
        assert.equal(p.stats.overBytes, true);
        const after = await tunnel(p.port);
        assert.notEqual(status(after.seen.text), 200, 'no new tunnel once the cap is hit');
      },
    );
  } finally {
    echo.close();
  }
});

test('C20: the byte cap also applies to plain HTTP responses and cuts the body', async () => {
  const big = await echoServer((s) => {
    s.once('data', () => {
      s.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100000\r\n\r\n');
      s.write(Buffer.alloc(100000, 98));
    });
  });
  try {
    await withProxy(
      {
        maxBytes: 5000,
        resolve: async () => [{ address: '203.0.113.9', family: 4 }],
        connect: async () => net.connect(big.port, '127.0.0.1'),
        testOverrides: { allowAddress: () => true },
      },
      async (p) => {
        const resp = await raw(
          p.port,
          'GET http://pub.example/ HTTP/1.1\r\nHost: pub.example\r\nConnection: close\r\n\r\n',
        );
        assert.ok(resp.length < 60000, `body was cut, got ${resp.length} bytes`);
        assert.equal(p.stats.overBytes, true);
      },
    );
  } finally {
    big.close();
  }
});

test('C20: closing the proxy with live tunnels and half-open requests completes promptly', async () => {
  const echo = await echoServer();
  try {
    const p = await createJobProxy({
      maxBytes: 1 << 20,
      maxRequests: 100,
      resolve: async () => [{ address: '203.0.113.9', family: 4 }],
      connect: async () => net.connect(echo.port, '127.0.0.1'),
      testOverrides: { allowAddress: () => true },
    });
    const t = await tunnel(p.port);
    const half = net.connect(p.port, '127.0.0.1');
    half.on('error', () => {});
    half.write('GET http://pub.example/ HTTP/1.1\r\nHost: pub.example\r\n');
    await pause(100);
    const t0 = Date.now();
    await p.close();
    assert.ok(Date.now() - t0 < 2000, 'close() did not wait for idle sockets');
    await pause(100);
    assert.equal(t.s.destroyed, true);
    assert.equal(half.destroyed, true);
  } finally {
    echo.close();
  }
});

test('C14: the proxy never forwards an Upgrade, plain or via CONNECT-less ws', async () => {
  const l = await listener();
  try {
    const ov = { allowAddress: () => true, allowPorts: [l.port] };
    await withProxy(
      { resolve: async () => [{ address: '127.0.0.1', family: 4 }], testOverrides: ov },
      async (p) => {
        const h = `pub.example:${l.port}`;
        const key = 'dGhlIHNhbXBsZSBub25jZQ==';
        const resp = await raw(
          p.port,
          `GET http://${h}/ws HTTP/1.1\r\nHost: ${h}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
        assert.equal(status(resp), 400);
        assert.doesNotMatch(resp, /101|Sec-WebSocket-Accept/i);
        // The ws:// scheme as an absolute target is not http and is refused too.
        assert.equal(
          status(
            await raw(
              p.port,
              `GET ws://${h}/ws HTTP/1.1\r\nHost: ${h}\r\nConnection: close\r\n\r\n`,
            ),
          ),
          400,
        );
        assert.equal(l.state.connections, 0);
      },
    );
  } finally {
    await l.close();
  }
});
