import { chromium, type Browser } from 'playwright-core';
import { assertLaunchArgs } from './sandbox.ts';

// Sandbox flags are never passed: Playwright keeps the Chromium sandbox on when
// chromiumSandbox is true.
export const BASE_ARGS: readonly string[] = [
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-extensions',
  '--no-first-run',
];

// Threat model R1/R2: loopback goes through the proxy too (and is refused by the guard), QUIC
// and non-proxied UDP/WebRTC are off, and Chromium never resolves names itself (the proxy
// does). The proxy itself is per context (launch option proxy "per-context"); with no proxy
// listener Chromium fails, it never goes direct. No remote-debugging port (pipe transport).
export const NETWORK_ARGS: readonly string[] = [
  '--proxy-bypass-list=<-loopback>',
  '--disable-quic',
  '--disable-features=WebRtcHideLocalIpsWithMdns,AsyncDns,DnsOverHttps',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
  '--no-pings',
  '--deny-permission-prompts',
];

export const ALL_ARGS: readonly string[] = [...BASE_ARGS, ...NETWORK_ARGS];

/** Environment for Chromium: the sidecar token must never reach the browser process. */
export function browserEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && k !== 'HEADLESS_TOKEN' && k !== 'HEADLESS_ALLOW_NO_TOKEN') out[k] = v;
  }
  return out;
}

export function launchBrowser(extraArgs: readonly string[] = []): Promise<Browser> {
  const args = [...ALL_ARGS, ...extraArgs];
  assertLaunchArgs(args);
  return chromium.launch({
    headless: true,
    chromiumSandbox: true,
    args,
    env: browserEnv(),
    proxy: { server: 'per-context' },
  });
}
