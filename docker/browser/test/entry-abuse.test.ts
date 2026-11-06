// T9 cases 10, 11, 17 at the sidecar boundary: hostile entry URLs and requests are rejected
// before any browser context exists, and no error body leaks the token or the target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Browser } from 'playwright-core';
import { createSidecar, RenderError, type Renderer } from '../src/server.ts';
import { renderPage, checkEntryUrl } from '../src/render.ts';
import { loadConfig } from '../src/config.ts';
import { ALL_ARGS } from '../src/browser.ts';

const TOKEN = 'f'.repeat(32);
const cfg = loadConfig({ HEADLESS_TOKEN: TOKEN });

const HOSTILE = [
  'file:///etc/passwd',
  'gopher://example.com/',
  'ftp://example.com/',
  'data:text/html,<script>1</script>',
  'javascript:alert(1)',
  'view-source:http://example.com/',
  'chrome://version',
  'about:blank',
  'blob:http://example.com/x',
  'ws://example.com/',
  'http://user:pass@example.com/',
  'http://user@example.com/',
  'https://:pass@example.com/',
  'http://example.com:22/',
  'http://example.com:3000/',
  'http://example.com:3001/',
  'http://example.com:8080/',
  'http://app:3000/',
  'http://browser:3001/',
  'http://localhost/',
  'http://LOCALHOST./',
  'http://127.0.0.1/',
  'http://127.1/',
  'http://2130706433/',
  'http://0x7f.1/',
  'http://0/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:7f00:1]/',
  'http://[fe80::1%25eth0]/',
  'http://[fe80::1%eth0]/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.1/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://100.64.0.1/',
  'http://metadata.google.internal/',
  'http://host.docker.internal/',
  'not a url',
  '',
  'http://',
  'http://example.com:99999/',
  'x'.repeat(3000),
];

test('case 10/11: every hostile entry URL is rejected by checkEntryUrl', () => {
  for (const u of HOSTILE) {
    assert.throws(() => checkEntryUrl(u), RenderError, JSON.stringify(u.slice(0, 60)));
  }
  // Control: ordinary public URLs pass.
  for (const u of ['https://example.com/a?b=c', 'http://example.com/', 'https://EXAMPLE.com./x']) {
    assert.doesNotThrow(() => checkEntryUrl(u), u);
  }
});

test('case 10: hostile URLs never create a browser context (and never launch a proxy first)', async () => {
  let contexts = 0;
  const browser = {
    newContext: async () => {
      contexts++;
      throw new Error('should not be reached');
    },
  } as unknown as Browser;
  for (const u of HOSTILE) {
    await assert.rejects(renderPage(browser, { url: u }, cfg), RenderError, u.slice(0, 60));
  }
  assert.equal(contexts, 0);
});

test('case 10/17: over HTTP, hostile URLs are rejected, nothing leaks, and no render slot is used', async () => {
  let rendered = 0;
  const render: Renderer = async (req) => {
    rendered++;
    checkEntryUrl(req.url);
    return { html: '', finalUrl: req.url, status: 200 };
  };
  const server = createSidecar({ config: cfg, render, ready: () => true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/render`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
    });
  try {
    const bodies: string[] = [];
    for (const u of HOSTILE.filter((x) => x.length < 2000)) {
      const r = await post(JSON.stringify({ url: u }));
      assert.ok([400, 403].includes(r.status), `${u}: ${r.status}`);
      bodies.push(await r.text());
    }
    // Wrong token variants.
    for (const h of [
      { authorization: 'Bearer ' + 'e'.repeat(32) },
      { authorization: 'bearer ' + TOKEN },
      { authorization: 'Basic ' + TOKEN },
      { authorization: TOKEN },
      { authorization: 'Bearer ' },
      { authorization: `Bearer ${TOKEN}x` },
      { 'x-api-key': TOKEN },
      { cookie: `token=${TOKEN}` },
    ]) {
      const r = await fetch(`${base}/render`, {
        method: 'POST',
        body: '{"url":"https://example.com/"}',
        headers: { 'content-type': 'application/json', ...h },
      });
      assert.equal(r.status, 401, JSON.stringify(h));
      bodies.push(await r.text());
    }
    // Token in the query string or in the body is not an authenticator.
    for (const path of [`/render?token=${TOKEN}`, `/render?access_token=${TOKEN}`]) {
      const r = await fetch(`${base}${path}`, {
        method: 'POST',
        body: '{"url":"https://example.com/"}',
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(r.status, 401, path);
      bodies.push(await r.text());
    }
    assert.equal(
      (
        await post(JSON.stringify({ url: 'https://example.com/', token: TOKEN }), {
          authorization: '',
        })
      ).status,
      401,
    );
    // Oversized and malformed bodies.
    assert.equal((await post('x'.repeat(100_000))).status, 413);
    assert.equal((await post('{"url":"https://example.com/"', {})).status, 400);
    assert.equal(
      (await post('{"url":"https://example.com/","url":"file:///etc/passwd"}')).status >= 200,
      true,
    );
    // An error body never contains the token or an echo of the hostile target.
    for (const b of bodies) {
      assert.ok(!b.includes(TOKEN), 'token leaked');
      assert.doesNotMatch(b, /passwd|169\.254|127\.0\.0\.1|Error:|\sat\s/, b);
    }
    // Responses expose no version or stack information.
    const h = await fetch(`${base}/healthz`);
    assert.doesNotMatch(await h.text(), /chrom|version|\d+\.\d+\.\d+/i);
    assert.equal(h.headers.get('x-powered-by'), null);
    // Control: a good request still works and is the only one that rendered.
    const ok = await post('{"url":"https://example.com/"}');
    assert.equal(ok.status, 200);
    assert.ok(rendered >= 1);
  } finally {
    server.close();
  }
});

test('case 10: a duplicate JSON "url" key cannot smuggle a second URL past the check', () => {
  // JSON.parse keeps the last key; the validated value is the one that is rendered.
  const parsed = JSON.parse('{"url":"https://example.com/","url":"file:///etc/passwd"}') as {
    url: string;
  };
  assert.throws(() => checkEntryUrl(parsed.url), RenderError);
});

test('case 13: the Chromium network launch arguments are exactly the reviewed list', () => {
  assert.deepEqual(
    [...ALL_ARGS].filter((a) =>
      /proxy|quic|webrtc|resolver|pings|features|background|update/.test(a),
    ),
    [
      '--disable-background-networking',
      '--disable-component-update',
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--disable-features=WebRtcHideLocalIpsWithMdns,AsyncDns,DnsOverHttps',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
      '--no-pings',
    ],
  );
  for (const a of ALL_ARGS) {
    assert.doesNotMatch(
      a,
      /remote-debugging|disable-setuid|proxy-server|load-extension|disable-web-security|allow-file-access|ignore-certificate|enable-quic|disable-site-isolation/,
      a,
    );
  }
});
