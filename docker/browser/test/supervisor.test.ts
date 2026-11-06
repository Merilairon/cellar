import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { RenderError } from '../src/server.ts';
import { Supervisor } from '../src/supervisor.ts';

const cfg = loadConfig({
  HEADLESS_ALLOW_NO_TOKEN: '1',
  RENDER_TIMEOUT_MS: '1000',
} as NodeJS.ProcessEnv);
const hangingLaunch = () => new Promise<Browser>(() => {});

test('m4: a browser launch that hangs is bounded by the render deadline', async () => {
  let killed = 0;
  const sup = new Supervisor(cfg, { launch: hangingLaunch, kill: () => void killed++ });
  const t0 = Date.now();
  await assert.rejects(
    sup.render({ url: 'https://example.com/' }),
    (e: unknown) => e instanceof RenderError && e.code === 'timeout',
  );
  const took = Date.now() - t0;
  assert.ok(took >= 900 && took < 4000, `took ${took} ms`);
  assert.equal(killed, 1);
});

test('m3: aborting the signal frees the job before the deadline', async () => {
  const sup = new Supervisor(cfg, { launch: hangingLaunch, kill: () => {} });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  const t0 = Date.now();
  await assert.rejects(sup.render({ url: 'https://example.com/' }, ac.signal), RenderError);
  assert.ok(Date.now() - t0 < 800, 'did not wait for the deadline');
});

test('an already aborted signal fails at once', async () => {
  const sup = new Supervisor(cfg, { launch: hangingLaunch, kill: () => {} });
  const t0 = Date.now();
  await assert.rejects(sup.render({ url: 'https://example.com/' }, AbortSignal.abort()));
  assert.ok(Date.now() - t0 < 800);
});
