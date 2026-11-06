import { chromium, type Browser } from 'playwright-core';
import { assertLaunchArgs } from './sandbox.ts';

// Network-related flags (proxy, WebRTC, prefetch) are added by T3. Sandbox flags are never
// passed: Playwright keeps the Chromium sandbox on when chromiumSandbox is true.
export const BASE_ARGS: readonly string[] = [
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-extensions',
  '--no-first-run',
];

/** Environment for Chromium: the sidecar token must never reach the browser process. */
export function browserEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && k !== 'HEADLESS_TOKEN' && k !== 'HEADLESS_ALLOW_NO_TOKEN') out[k] = v;
  }
  return out;
}

export function launchBrowser(extraArgs: readonly string[] = []): Promise<Browser> {
  const args = [...BASE_ARGS, ...extraArgs];
  assertLaunchArgs(args);
  return chromium.launch({ headless: true, chromiumSandbox: true, args, env: browserEnv() });
}
