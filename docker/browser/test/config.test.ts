import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { browserEnv } from '../src/browser.ts';

test('defaults', () => {
  const c = loadConfig({ HEADLESS_ALLOW_NO_TOKEN: '1' });
  assert.equal(c.port, 3001);
  assert.equal(c.token, null);
  assert.equal(c.renderTimeoutMs, 30_000);
  assert.equal(c.maxConcurrentRenders, 1);
});

test('render timeout is clamped to the 30 s hard max', () => {
  assert.equal(
    loadConfig({ RENDER_TIMEOUT_MS: '120000', HEADLESS_ALLOW_NO_TOKEN: '1' }).renderTimeoutMs,
    30_000,
  );
  assert.equal(
    loadConfig({ RENDER_TIMEOUT_MS: '5000', HEADLESS_ALLOW_NO_TOKEN: '1' }).renderTimeoutMs,
    5000,
  );
});

test('refuses to start without a token unless explicitly allowed (R7)', () => {
  assert.throws(() => loadConfig({}), /HEADLESS_TOKEN is required/);
  assert.throws(() => loadConfig({ HEADLESS_ALLOW_NO_TOKEN: 'true' }), /required/);
  assert.equal(loadConfig({ HEADLESS_ALLOW_NO_TOKEN: '1' }).noToken, true);
});

test('rejects bad values and short tokens', () => {
  assert.throws(() => loadConfig({ PORT: 'abc', HEADLESS_ALLOW_NO_TOKEN: '1' }));
  assert.throws(() => loadConfig({ PORT: '70000', HEADLESS_ALLOW_NO_TOKEN: '1' }));
  assert.throws(() => loadConfig({ HEADLESS_TOKEN: 'short' }));
  assert.equal(loadConfig({ HEADLESS_TOKEN: 'x'.repeat(32) }).token, 'x'.repeat(32));
});

test('the token never reaches the Chromium environment', () => {
  const env = browserEnv({ HEADLESS_TOKEN: 'secret', PATH: '/bin', HEADLESS_ALLOW_NO_TOKEN: '1' });
  assert.deepEqual(env, { PATH: '/bin' });
});
