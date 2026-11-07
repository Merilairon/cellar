import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  createSidecar,
  tokenOk,
  RenderError,
  HTTP_LIMITS,
  MAX_URL_LENGTH,
  type Renderer,
} from '../src/server.ts';
import { loadConfig } from '../src/config.ts';

const TOKEN = '0123456789abcdef0123456789abcdef';
let calls = 0;
let release: (() => void) | null = null;
const render: Renderer = async (req) => {
  calls++;
  if (req.url.includes('hang')) await new Promise<void>((r) => (release = r));
  if (req.url.includes('blocked')) throw new RenderError('blocked', 403);
  return { html: '<p>x</p>', finalUrl: req.url, status: 200 };
};
let server: Server;
let base = '';
let ready = true;

before(async () => {
  server = createSidecar({
    config: loadConfig({ HEADLESS_TOKEN: TOKEN }),
    render,
    ready: () => ready,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/render`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
  });

test('healthz needs no token and follows readiness', async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  ready = false;
  assert.equal((await fetch(`${base}/healthz`)).status, 503);
  const down = await post('{"url":"https://example.com/"}');
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { error: 'failed' }); // not ready is not "busy"
  ready = true;
});

test('render without or with a wrong token is 401 and does no work', async () => {
  const before = calls;
  const none = await fetch(`${base}/render`, {
    method: 'POST',
    body: '{"url":"https://a.test/"}',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(none.status, 401);
  assert.equal(
    (await post('{"url":"https://a.test/"}', { authorization: 'Bearer wrong' })).status,
    401,
  );
  assert.equal((await post('{"url":"https://a.test/"}', { authorization: TOKEN })).status, 401);
  assert.equal(
    (
      await fetch(`${base}/render?token=${TOKEN}`, {
        method: 'POST',
        body: '{"url":"https://a.test/"}',
        headers: { 'content-type': 'application/json' },
      })
    ).status,
    401,
  );
  assert.equal(calls, before);
});

test('happy path and renderer errors map to the G5 response', async () => {
  const ok = await post('{"url":"https://a.test/","waitMs":500}');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { html: '<p>x</p>', finalUrl: 'https://a.test/', status: 200 });
  const blocked = await post('{"url":"https://a.test/blocked"}');
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: 'blocked' });
});

test('malformed JSON, unknown fields and bad types are 400', async () => {
  for (const b of [
    '{nope',
    '[]',
    'null',
    '{"url":1}',
    '{"url":""}',
    '{"url":"https://a.test/","headers":{}}',
    '{"url":"https://a.test/","waitMs":-1}',
    '{"url":"https://a.test/","waitMs":1.5}',
  ])
    assert.equal((await post(b)).status, 400, b);
});

test('non-JSON content type is 415, oversize body 413', async () => {
  assert.equal(
    (await post('{"url":"https://a.test/"}', { 'content-type': 'text/plain' })).status,
    415,
  );
  assert.equal(
    (await post(JSON.stringify({ url: 'https://a.test/' + 'a'.repeat(9000) }))).status,
    413,
  );
});

test('unknown paths are 404, wrong methods 405', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/render`)).status, 405);
  assert.equal((await fetch(`${base}/healthz`, { method: 'POST' })).status, 405);
});

test('second concurrent render gets 503 immediately', async () => {
  const first = post('{"url":"https://a.test/hang"}');
  await new Promise((r) => setTimeout(r, 100));
  const second = await post('{"url":"https://a.test/"}');
  assert.equal(second.status, 503);
  // At capacity is reported as busy so the app can say "try again in a moment".
  assert.deepEqual(await second.json(), { error: 'busy' });
  release?.();
  assert.equal((await first).status, 200);
});

test('tokenOk is strict about the Bearer scheme', () => {
  assert.equal(tokenOk(undefined, null), true);
  assert.equal(tokenOk('Bearer abc', 'abc'), true);
  assert.equal(tokenOk('bearer abc', 'abc'), false);
  assert.equal(tokenOk('abc', 'abc'), false);
  assert.equal(tokenOk(undefined, 'abc'), false);
});

test('F4: header/request timeouts and header size are tightened below Node defaults', () => {
  assert.equal(server.headersTimeout, 5000);
  assert.equal(server.requestTimeout, 15_000);
  assert.ok(HTTP_LIMITS.maxHeaderSize <= 8192);
});

test('F4: an oversized header block is refused with 431', async () => {
  const r = await fetch(`${base}/healthz`, { headers: { 'x-pad': 'a'.repeat(10_000) } });
  assert.equal(r.status, 431);
});

test('F4: BIND_ADDR is honoured and must be an IP literal', async () => {
  assert.equal(loadConfig({ HEADLESS_TOKEN: TOKEN }).bindAddr, '0.0.0.0');
  assert.equal(loadConfig({ HEADLESS_TOKEN: TOKEN, BIND_ADDR: '127.0.0.1' }).bindAddr, '127.0.0.1');
  assert.throws(
    () => loadConfig({ HEADLESS_TOKEN: TOKEN, BIND_ADDR: 'evil.example' }),
    /BIND_ADDR/,
  );
  const s = createSidecar({
    config: loadConfig({ HEADLESS_TOKEN: TOKEN, BIND_ADDR: '127.0.0.1' }),
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  assert.equal((s.address() as AddressInfo).address, '127.0.0.1');
  s.close();
});

test('m3: a client that disconnects aborts the render signal and frees the slot', async () => {
  const { createSidecar: make } = await import('../src/server.ts');
  let seen: AbortSignal | undefined;
  let started!: () => void;
  const begun = new Promise<void>((r) => (started = r));
  const s = make({
    config: loadConfig({ HEADLESS_TOKEN: TOKEN }),
    render: (_r, _c, signal) => {
      seen = signal;
      started();
      return new Promise((_, reject) =>
        signal!.addEventListener('abort', () => reject(new RenderError('failed')), { once: true }),
      );
    },
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/render`;
  const ac = new AbortController();
  const p = fetch(url, {
    method: 'POST',
    body: '{"url":"https://a.test/"}',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    signal: ac.signal,
  }).catch(() => undefined);
  await begun;
  assert.equal(seen?.aborted, false);
  ac.abort();
  await p;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(seen?.aborted, true);
  s.close();
});

test('URL limit matches the app MAX_IMPORT_URL: 2048 passes, 2049 is rejected (400)', async () => {
  assert.equal(MAX_URL_LENGTH, 2048);
  const mk = (n: number) => 'https://a.test/' + 'a'.repeat(n - 'https://a.test/'.length);
  const ok = await post(JSON.stringify({ url: mk(2048) }));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { finalUrl: string }).finalUrl.length, 2048);
  assert.equal((await post(JSON.stringify({ url: mk(2049) }))).status, 400);
});
