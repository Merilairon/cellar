import { getEnv } from '@/lib/env';
import { log } from '@/lib/log';
import messages from '../../../messages/en.json';
import { getClientIp, UNKNOWN_CLIENT } from './request-client';
import { getRateLimiter } from './rate-limit';

/** Paths of the anonymous share-link page; the only ones that get the public limiter. */
export function isPublicSharePath(pathname: string): boolean {
  if (pathname.startsWith('/r/')) return true;
  // Encoded forms (`/%72/x`, `/r%2Fx`) must not dodge the limiter or the Referrer-Policy:
  // judge the decoded path, and treat an undecodable one as a share path (conservative).
  if (!pathname.includes('%')) return false;
  try {
    return decodeURIComponent(pathname).startsWith('/r/');
  } catch {
    return true;
  }
}

/**
 * IPv6 clients are keyed on their /64, so rotating addresses inside one prefix cannot dodge the
 * limit. The notation is canonicalised first (`::` expanded, leading zeros and case dropped), so
 * `2001:0DB8:0:0:...` and `2001:db8::...` share one bucket.
 */
export function limiterKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('%')[0]!.split('::');
  const hs = head ? head.split(':') : [];
  const ts = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...hs, ...Array<string>(Math.max(0, 8 - hs.length - ts.length)).fill('0'), ...ts]
    : hs;
  const prefix = groups.slice(0, 4).map((g) => parseInt(g || '0', 16));
  if (prefix.some(Number.isNaN)) return ip.toLowerCase();
  return prefix.map((n) => n.toString(16)).join(':') + '::/64';
}

let blockedSinceLog = 0;
let lastBlockedLog = 0;
export const BLOCKED_LOG_INTERVAL_MS = 60_000;

/**
 * `public_page.rate_limited`: a count only, no client address (not even hashed), and at most
 * one line per minute so a flood cannot also flood the log.
 */
function noteBlocked(now = Date.now()): void {
  blockedSinceLog++;
  if (now - lastBlockedLog < BLOCKED_LOG_INTERVAL_MS) return;
  lastBlockedLog = now;
  log('warn', 'public_page.rate_limited', { count: blockedSinceLog });
  blockedSinceLog = 0;
}

/**
 * Per-IP limiter for `GET /r/*` (G5). It runs in `proxy.ts` because a page cannot return a 429
 * (G6). The limiter registry lives on `globalThis`, shared with route modules (T0 spike 1).
 *
 * Returns `null` when the request may proceed, else the seconds to wait. An unknown client
 * (no TRUSTED_PROXIES, or an untrusted peer) is not limited: all such visitors would share
 * one bucket and lock each other out, the same rule as login. The 128-bit token already makes
 * enumeration infeasible; the limit protects CPU.
 */
export function publicRateLimit(headers: { get(name: string): string | null }): number | null {
  // A broken env must not turn the uniform 404 into a 500: fail open here (the page and
  // every other route fail loudly on the same env anyway).
  try {
    const ip = getClientIp(headers);
    if (ip === UNKNOWN_CLIENT) return null;
    const e = getEnv();
    const r = getRateLimiter('public:ip', {
      limit: e.RATE_LIMIT_PUBLIC_MAX,
      windowMs: e.RATE_LIMIT_PUBLIC_WINDOW_SEC * 1000,
    }).hit(limiterKey(ip));
    if (r.allowed) return null;
    noteBlocked();
    return r.retryAfterSec;
  } catch {
    return null;
  }
}

/**
 * 429 body. The proxy has no session, so no per-user locale: the one shipped catalog is used
 * (`errors.rateLimited`, UX spec section 3.3). Revisit when a second language is added.
 */
export const PUBLIC_RATE_LIMITED_BODY: string = messages.errors.rateLimited;
