// One render job: fresh context, per-job proxy, policy, bounded waits (T4). The wall-clock
// kill lives in supervisor.ts; this function only owns the job's resources and closes them.
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { Config } from './config.ts';
import { RenderError, type RenderRequest, type RenderResult } from './server.ts';
import { createJobProxy, type Resolver, type TestOverrides } from './proxy.ts';
import { decide, installPolicy } from './policy.ts';

export const MAX_DOM_BYTES = 5 * 1024 * 1024;
export const DEFAULT_IDLE_WAIT_MS = 5000;
export const USER_AGENT = 'CellarBot/0.3 (recipe importer; headless)';

export type RenderDeps = {
  resolve?: Resolver;
  testOverrides?: TestOverrides;
  /** Called once the job's context exists, so the supervisor can close it on a kill. */
  onContext?: (ctx: BrowserContext) => void;
};

/** Entry URL rules: http(s), no userinfo, default port, no blocked literal or name. */
export function checkEntryUrl(raw: string, ov?: TestOverrides): URL {
  if (raw.length > 2000) throw new RenderError('failed', 400);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RenderError('failed', 400);
  }
  const d = decide(u.href, 'document', 'GET', true, ov ?? {});
  if (d === 'host') throw new RenderError('private_address', 403);
  if (d !== 'allow') throw new RenderError('failed', 400);
  return u;
}

export async function renderPage(
  browser: Browser,
  req: RenderRequest,
  cfg: Config,
  deps: RenderDeps = {},
): Promise<RenderResult> {
  const entry = checkEntryUrl(req.url, deps.testOverrides);
  const proxy = await createJobProxy({
    resolve: deps.resolve,
    maxBytes: cfg.maxTotalBytes,
    maxRequests: cfg.maxSubRequests,
    testOverrides: deps.testOverrides,
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      proxy: { server: `http://127.0.0.1:${proxy.port}` },
      acceptDownloads: false,
      javaScriptEnabled: true,
      serviceWorkers: 'block',
      permissions: [],
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      locale: 'en-US',
      timezoneId: 'UTC',
      userAgent: USER_AGENT,
    });
    deps.onContext?.(context);
    const policy = await installPolicy(context, {
      maxSubRequests: cfg.maxSubRequests,
      maxRedirects: cfg.maxRedirects,
      allowPorts: deps.testOverrides?.allowPorts,
      allowAddress: deps.testOverrides?.allowAddress,
    });
    const page = await context.newPage();
    const crashed = new Promise<never>((_, rej) =>
      page.on('crash', () => rej(new RenderError('failed', 502))),
    );
    crashed.catch(() => {});

    const hits = () => proxy.stats.blockedPrivate + policy.blockedHost;
    const work = navigate(page, entry.href, req.waitMs ?? DEFAULT_IDLE_WAIT_MS, cfg, hits);
    let result: RenderResult;
    try {
      result = await Promise.race([work, crashed]);
    } catch (e) {
      if (e instanceof RenderError) throw e;
      if (policy.downloads > 0 || /Download is starting/i.test(String(e))) {
        throw new RenderError('failed', 502);
      }
      if (proxy.stats.overBytes) throw new RenderError('too_large', 502);
      // A sub-resource refusal never fails goto, so a failed navigation with guard hits means
      // the document (or one of its redirect hops) was refused.
      if (hits() > 0) throw new RenderError('private_address', 403);
      throw new RenderError('failed', 502);
    }
    if (policy.downloads > 0) throw new RenderError('failed', 502);
    if (proxy.stats.overBytes) throw new RenderError('too_large', 502);
    if (policy.requestsExceeded || proxy.stats.overRequests) throw new RenderError('failed', 502);
    return {
      ...result,
      warnings: policy.blocked + proxy.stats.blockedPrivate + proxy.stats.blockedPolicy,
    };
  } finally {
    await context?.close().catch(() => {});
    await proxy.close();
  }
}

async function navigate(
  page: Page,
  url: string,
  idleMs: number,
  cfg: Config,
  hits: () => number,
): Promise<RenderResult> {
  // A navigation that dies after the guard refused something was refused by the guard.
  const refused = () =>
    hits() > 0 ? new RenderError('private_address', 403) : new RenderError('failed', 502);
  const resp = await page
    .goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.renderTimeoutMs + 2000 })
    .catch((e: unknown) => {
      if (/Download is starting/i.test(String(e))) throw new RenderError('failed', 502);
      throw hits() > 0 ? refused() : e;
    });
  if (!resp) throw new RenderError('failed', 502);
  if (resp.headers()['x-cellar-proxy'] === 'blocked') throw new RenderError('private_address', 403);
  const status = resp.status();
  if (status === 401 || status === 403 || status === 429) throw new RenderError('blocked', 403);
  if (status < 200 || status >= 300) throw new RenderError('failed', 502);
  const headers = resp.headers();
  if (/attachment/i.test(headers['content-disposition'] ?? ''))
    throw new RenderError('failed', 502);
  if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(headers['content-type'] ?? '')) {
    throw new RenderError('failed', 502);
  }
  // Bounded settle: network idle up to the cap, never past the kill; a busy page is not an error.
  await page
    .waitForLoadState('networkidle', { timeout: Math.min(idleMs, cfg.renderTimeoutMs) })
    .catch(() => {});
  const finalUrl = page.url();
  if (!/^https?:\/\//i.test(finalUrl)) throw refused();
  const len = await page.evaluate<number>('document.documentElement.outerHTML.length');
  if (len > MAX_DOM_BYTES) throw new RenderError('too_large', 502);
  const html = await page.content();
  if (Buffer.byteLength(html) > MAX_DOM_BYTES) throw new RenderError('too_large', 502);
  return { html, finalUrl, status };
}
