// Route policy for one job's browser context (G8, G11, R3, R5). The proxy is the network
// boundary; this layer cuts requests early and counts them. Blocked targets are recorded as a
// count only, never as URLs or hosts.
import type { BrowserContext, Page, Request, Route } from 'playwright-core';
import { isBlockedHostname, isBlockedIp, isIpLiteral } from './ip-guard.ts';

export const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'document',
  'script',
  'xhr',
  'fetch',
  'stylesheet',
]);

export type Decision = 'allow' | 'scheme' | 'port' | 'userinfo' | 'type' | 'method' | 'host';

export type PolicyOptions = {
  maxSubRequests: number;
  maxRedirects: number;
  /** Test-only seam (see proxy.ts); production never sets it. */
  allowPorts?: readonly number[];
  allowAddress?: (ip: string) => boolean;
};

/** Pure decision for one request. */
export function decide(
  rawUrl: string,
  resourceType: string,
  method: string,
  isNavigation: boolean,
  opts: Pick<PolicyOptions, 'allowPorts' | 'allowAddress'> = {},
): Decision {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return 'scheme';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'scheme';
  if (u.username || u.password) return 'userinfo';
  if (u.port !== '' && !opts.allowPorts?.includes(Number(u.port))) return 'port';
  if (!ALLOWED_TYPES.has(resourceType)) return 'type';
  if (isNavigation ? method !== 'GET' : method !== 'GET' && method !== 'HEAD') return 'method';
  const host = u.hostname.replace(/\.$/, '');
  if (isIpLiteral(host)) {
    const ip = host.replace(/^\[|\]$/g, '');
    if (!opts.allowAddress?.(ip) && isBlockedIp(ip)) return 'host';
  } else if (isBlockedHostname(host)) {
    return 'host';
  }
  return 'allow';
}

export type PolicyStats = {
  requests: number;
  blocked: number;
  /** Subset of `blocked` refused by the address/host guard. */
  blockedHost: number;
  redirectsExceeded: boolean;
  requestsExceeded: boolean;
  downloads: number;
  popups: number;
};

export async function installPolicy(
  context: BrowserContext,
  opts: PolicyOptions,
): Promise<PolicyStats> {
  const stats: PolicyStats = {
    requests: 0,
    blocked: 0,
    blockedHost: 0,
    redirectsExceeded: false,
    requestsExceeded: false,
    downloads: 0,
    popups: 0,
  };
  const redirectDepth = (r: Request): number => {
    let n = 0;
    for (let p = r.redirectedFrom(); p; p = p.redirectedFrom()) n++;
    return n;
  };

  await context.route('**/*', async (route: Route) => {
    const req = route.request();
    stats.requests++;
    let verdict = decide(
      req.url(),
      req.resourceType(),
      req.method(),
      req.isNavigationRequest(),
      opts,
    );
    if (verdict === 'allow') {
      if (stats.requests > opts.maxSubRequests) {
        stats.requestsExceeded = true;
        verdict = 'type';
      } else if (redirectDepth(req) > opts.maxRedirects) {
        stats.redirectsExceeded = true;
        verdict = 'type';
      }
    }
    if (verdict !== 'allow') {
      stats.blocked++;
      if (verdict === 'host') stats.blockedHost++;
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });
  // R3: WebSocket traffic is not visible to route(); close every socket the page opens.
  await context.routeWebSocket('**', (ws) => {
    stats.blocked++;
    void ws.close();
  });

  // Redirect hops are followed inside Chromium and do not re-enter route(); count them from the
  // request events and kill the page at the cap (R5). The proxy still checks every hop.
  context.on('request', (r: Request) => {
    if (redirectDepth(r) > opts.maxRedirects) {
      stats.redirectsExceeded = true;
      for (const p of context.pages()) void p.close().catch(() => {});
    }
  });

  context.on('page', (page: Page) => {
    page.on('dialog', (d) => void d.dismiss().catch(() => {}));
    page.on('download', (d) => {
      stats.downloads++;
      void d.cancel().catch(() => {});
    });
    // The first page is the job's own; any further page is a popup and is closed at once.
    if (context.pages().length > 1) {
      stats.popups++;
      void page.close().catch(() => {});
    }
  });
  return stats;
}
