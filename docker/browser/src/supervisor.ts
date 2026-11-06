// Owns the long-lived Chromium process and the 30 s wall-clock kill (G9, G10). One new context
// per job (render.ts); after a kill or crash the next job gets a fresh browser.
import { readdirSync, readFileSync } from 'node:fs';
import type { Browser, BrowserContext } from 'playwright-core';
import type { Config } from './config.ts';
import { launchBrowser } from './browser.ts';
import { renderPage, type RenderDeps } from './render.ts';
import { RenderError, type RenderRequest, type RenderResult } from './server.ts';

const sleepRace = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p.catch(() => undefined), new Promise<void>((r) => setTimeout(r, ms).unref())]);

/** Descendant pids of this process whose command line looks like Chromium (via /proc). */
export function chromiumDescendants(proc = '/proc', root = process.pid): number[] {
  const parent = new Map<number, number>();
  const chrome = new Set<number>();
  for (const e of readdirSync(proc)) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const stat = readFileSync(`${proc}/${e}/stat`, 'utf8');
      const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      parent.set(Number(e), Number(after[1]));
      const cmd = readFileSync(`${proc}/${e}/cmdline`, 'utf8').split('\0')[0] ?? '';
      if (/chrom|headless_shell/.test(cmd.split('/').pop() ?? '')) chrome.add(Number(e));
    } catch {
      // exited while scanning
    }
  }
  const out: number[] = [];
  for (const pid of chrome) {
    for (let p = parent.get(pid), n = 0; p !== undefined && n < 64; p = parent.get(p), n++) {
      if (p === root) {
        out.push(pid);
        break;
      }
    }
  }
  return out;
}

export function killChromium(pids: number[] = chromiumDescendants()): void {
  for (const pid of pids) {
    // Playwright starts Chromium in its own process group: kill the group, then the pid.
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

export type SupervisorDeps = RenderDeps & {
  launch?: () => Promise<Browser>;
  kill?: (pids?: number[]) => void;
};

export class Supervisor {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  readonly cfg: Config;
  private deps: SupervisorDeps;

  constructor(cfg: Config, deps: SupervisorDeps = {}) {
    this.cfg = cfg;
    this.deps = deps;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.launching ??= (this.deps.launch ?? (() => launchBrowser()))()
      .then((b) => {
        this.browser = b;
        b.on('disconnected', () => {
          if (this.browser === b) this.browser = null;
        });
        return b;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  /** Open contexts on the live browser (zero between jobs). */
  openContexts(): number {
    return this.browser?.contexts().length ?? 0;
  }

  /** G9: context.close, browser.close, then SIGKILL of whatever is left. */
  private async hardKill(ctx: BrowserContext | undefined): Promise<void> {
    const b = this.browser;
    this.browser = null;
    // Snapshot first: only this browser's processes may be killed, never a relaunched one.
    const pids = chromiumDescendants();
    if (ctx) await sleepRace(ctx.close(), 1000);
    if (b) await sleepRace(b.close(), 1500);
    (this.deps.kill ?? killChromium)(pids);
  }

  /**
   * The wall-clock budget covers the browser launch as well as the page (a cold start after a
   * kill must not extend a job past the cap, and a hung launch must not hold the slot). The
   * job is also torn down when `signal` aborts (the caller went away), so an orphaned render
   * cannot keep the slot until the deadline.
   */
  render = async (req: RenderRequest, signal?: AbortSignal): Promise<RenderResult> => {
    let ctx: BrowserContext | undefined;
    let killed: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    let over = false;
    const deadline = new Promise<never>((_, reject) => {
      stop = () => {
        if (over) return;
        over = true;
        // Abandon an in-flight launch so the next job starts its own instead of joining a hang.
        this.launching = null;
        // Reply only after the old browser is gone, so the next job cannot race the kill.
        killed = this.hardKill(ctx);
        void killed.finally(() => reject(new RenderError('timeout', 504)));
      };
      timer = setTimeout(() => stop?.(), this.cfg.renderTimeoutMs);
    });
    deadline.catch(() => {});
    const onAbort = () => stop?.();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await Promise.race([
        this.ensureBrowser().then((browser) => {
          if (over) throw new RenderError('timeout', 504); // launch finished after the deadline
          return renderPage(browser, req, this.cfg, { ...this.deps, onContext: (c) => (ctx = c) });
        }),
        deadline,
      ]);
    } catch (e) {
      if (killed) {
        await killed;
        throw new RenderError('timeout', 504);
      }
      if (e instanceof RenderError) throw e;
      throw new RenderError('failed', 502);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };

  async shutdown(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await sleepRace(b.close(), 2000);
    (this.deps.kill ?? killChromium)();
  }
}
