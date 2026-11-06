// Sandbox policy and startup self-check (threat model section 5, conditions 4, 5, 6).
// Chromium must run with its own sandbox. The forbidden flags are built from parts so the CI
// grep gate (scripts/check-no-nosandbox.sh) can ban the literal strings everywhere, this file
// included, without an allowlist.
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import type { Browser } from 'playwright-core';

const DASH = '--';
export const FORBIDDEN_FLAGS: readonly string[] = [
  [DASH + 'no', 'sandbox'].join('-'),
  [DASH + 'disable', 'setuid', 'sandbox'].join('-'),
  [DASH + 'disable', 'gpu', 'sandbox'].join('-'),
];

export class SandboxError extends Error {}

/** Throws if any launch argument is a forbidden sandbox-weakening flag. */
export function assertLaunchArgs(args: readonly string[]): void {
  for (const a of args) {
    if (FORBIDDEN_FLAGS.some((f) => a === f || a.startsWith(f + '='))) {
      throw new SandboxError(`forbidden Chromium flag: ${a}`);
    }
  }
}

export type Probe = {
  uid: number;
  maxUserNamespaces: number | null;
  /** Own user namespace id, e.g. "user:[4026531837]". */
  ownUserNs: string | null;
  /** Command lines and user namespaces of Chromium processes. */
  chromeProcs: { cmdline: string[]; userNs: string | null }[];
};

export function readProbe(proc = '/proc'): Probe {
  const num = (p: string) => {
    try {
      return Number(readFileSync(p, 'utf8').trim());
    } catch {
      return null;
    }
  };
  const ns = (pid: string) => {
    try {
      return readlinkSync(`${proc}/${pid}/ns/user`);
    } catch {
      return null;
    }
  };
  const chromeProcs: Probe['chromeProcs'] = [];
  for (const pid of readdirSync(proc)) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      const cmdline = readFileSync(`${proc}/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      if (cmdline.some((c) => /chrom|headless_shell/.test(c.split('/').pop() ?? ''))) {
        chromeProcs.push({ cmdline, userNs: ns(pid) });
      }
    } catch {
      // process exited while scanning
    }
  }
  return {
    uid: process.getuid?.() ?? -1,
    maxUserNamespaces: num(`${proc}/sys/user/max_user_namespaces`),
    ownUserNs: ns('self'),
    chromeProcs,
  };
}

/** Pure decision: throws SandboxError with a clear message when the sandbox is not active. */
export function evaluateSandbox(p: Probe): void {
  if (p.uid === 0) throw new SandboxError('refusing to run as root (uid 0)');
  if (p.chromeProcs.length === 0) throw new SandboxError('no Chromium process found to inspect');
  for (const c of p.chromeProcs) assertLaunchArgs(c.cmdline);
  // Layer-1 user namespace sandbox: sandboxed children live in a user namespace of their own.
  const sandboxed = p.chromeProcs.some(
    (c) => c.userNs !== null && p.ownUserNs !== null && c.userNs !== p.ownUserNs,
  );
  if (!sandboxed) {
    throw new SandboxError('Chromium sandbox is not active (no process in its own user namespace)');
  }
}

export function explainLaunchFailure(err: unknown, maxUserNs: number | null): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (maxUserNs === 0) {
    return 'UNSUPPORTED HOST: user.max_user_namespaces=0, the Chromium sandbox cannot start. Enable unprivileged user namespaces on the host or leave the headless profile off.';
  }
  if (/sandbox|namespace|chroot/i.test(msg)) {
    return `Chromium sandbox could not start (check seccomp profile and cap_add SYS_CHROOT): ${msg.split('\n')[0]}`;
  }
  return `Chromium failed to launch: ${msg.split('\n')[0]}`;
}

/**
 * Startup self-check. Launches Chromium with its sandbox on, opens a page so a renderer
 * exists, and verifies uid, flags and user-namespace isolation. Resolves only when all pass.
 */
export async function selfCheck(
  launch: () => Promise<Browser>,
  probe: () => Probe = readProbe,
): Promise<{ version: string }> {
  const before = probe();
  if (before.uid === 0) throw new SandboxError('refusing to run as root (uid 0)');
  let browser: Browser;
  try {
    browser = await launch();
  } catch (err) {
    throw new SandboxError(explainLaunchFailure(err, before.maxUserNamespaces));
  }
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');
    evaluateSandbox(probe());
    await ctx.close();
    return { version: browser.version() };
  } finally {
    await browser.close().catch(() => {});
  }
}
