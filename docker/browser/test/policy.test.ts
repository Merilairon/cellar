import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { decide } from '../src/policy.ts';
import { ALL_ARGS, BASE_ARGS, NETWORK_ARGS } from '../src/browser.ts';
import { assertLaunchArgs } from '../src/sandbox.ts';
import { checkEntryUrl } from '../src/render.ts';
import { RenderError } from '../src/server.ts';

test('C7: only http(s) is allowed; file, ftp, chrome, view-source, javascript, data, blob, about are not', () => {
  for (const u of [
    'file:///etc/passwd',
    'ftp://example.com/',
    'chrome://settings',
    'view-source:https://example.com/',
    'javascript:alert(1)',
    'data:text/html,hi',
    'blob:https://example.com/x',
    'about:blank',
    'gopher://example.com/',
  ]) {
    assert.equal(decide(u, 'document', 'GET', true), 'scheme', u);
  }
});

test('policy: ports, userinfo, resource types and methods', () => {
  assert.equal(decide('https://example.com/', 'document', 'GET', true), 'allow');
  assert.equal(decide('https://example.com:443/', 'document', 'GET', true), 'allow');
  assert.equal(decide('http://example.com:8080/', 'document', 'GET', true), 'port');
  assert.equal(decide('http://example.com:22/', 'xhr', 'GET', false), 'port');
  assert.equal(decide('http://u:p@example.com/', 'document', 'GET', true), 'userinfo');
  for (const t of [
    'image',
    'media',
    'font',
    'websocket',
    'eventsource',
    'manifest',
    'other',
    'ping',
  ]) {
    assert.equal(decide('https://example.com/a', t, 'GET', false), 'type', t);
  }
  for (const t of ['script', 'xhr', 'fetch', 'stylesheet']) {
    assert.equal(decide('https://example.com/a', t, 'GET', false), 'allow', t);
  }
  assert.equal(decide('https://example.com/a', 'fetch', 'POST', false), 'method');
  assert.equal(decide('https://example.com/a', 'fetch', 'HEAD', false), 'allow');
  assert.equal(decide('https://example.com/', 'document', 'POST', true), 'method');
  assert.equal(decide('https://example.com/', 'document', 'HEAD', true), 'method');
});

test('policy: blocked literals and names (C1, C12)', () => {
  for (const u of [
    'http://127.0.0.1/',
    'http://localhost/',
    'http://localhost./',
    'http://[::1]/',
    'http://169.254.169.254/',
    'http://2130706433/',
    'http://10.0.0.1/',
    'https://[::ffff:10.0.0.1]/',
    'http://foo.localhost/',
  ]) {
    assert.equal(decide(u, 'fetch', 'GET', false), 'host', u);
  }
});

test('C10: entry URL checks reject before any context exists', () => {
  const code = (u: string) => {
    try {
      checkEntryUrl(u);
      return 'ok';
    } catch (e) {
      return e instanceof RenderError ? e.code : 'other';
    }
  };
  assert.equal(code('https://example.com/recipe'), 'ok');
  for (const u of [
    'file:///etc/passwd',
    'gopher://x/',
    'http://user:pass@example.com/',
    'http://example.com:22/',
    'http://app:3000/',
    'http://browser:3001/',
    'nonsense',
    'http://[fe80::1%25eth0]/',
  ]) {
    assert.notEqual(code(u), 'ok', u);
  }
  assert.equal(code('http://127.0.0.1:3001/render'), 'failed'); // port rule first
  assert.equal(code('http://127.0.0.1/'), 'private_address');
  assert.equal(code('http://localhost/'), 'private_address');
  assert.equal(code('http://[::ffff:127.0.0.1]/'), 'private_address');
});

test('R1/R2: the exact Chromium launch argument list', () => {
  assert.deepEqual([...ALL_ARGS], [...BASE_ARGS, ...NETWORK_ARGS]);
  assert.deepEqual(
    [...NETWORK_ARGS],
    [
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--disable-features=WebRtcHideLocalIpsWithMdns,AsyncDns,DnsOverHttps',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
      '--no-pings',
      '--deny-permission-prompts',
    ],
  );
  for (const must of [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-extensions',
  ]) {
    assert.ok(ALL_ARGS.includes(must), must);
  }
  assertLaunchArgs(ALL_ARGS);
  for (const a of ALL_ARGS) {
    assert.ok(!/remote-debugging|--proxy-server|direct:\/\//.test(a), a);
  }
});

test('one block-list: the sidecar ip-guard is byte-identical to the app guard', () => {
  const app = readFileSync(new URL('../../../src/lib/import/ip-guard.ts', import.meta.url));
  const side = readFileSync(new URL('../src/ip-guard.ts', import.meta.url));
  assert.ok(app.equals(side), 'run: cp src/lib/import/ip-guard.ts docker/browser/src/ip-guard.ts');
});

test('sidecar sources build no RegExp from data', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const f of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /new RegExp\(/, f);
  }
});

test('checkEntryUrl: the length cap is 2048, the same as the app MAX_IMPORT_URL', () => {
  const mk = (n: number) => 'https://example.com/' + 'a'.repeat(n - 'https://example.com/'.length);
  assert.doesNotThrow(() => checkEntryUrl(mk(2048)));
  assert.throws(() => checkEntryUrl(mk(2049)), RenderError);
});
