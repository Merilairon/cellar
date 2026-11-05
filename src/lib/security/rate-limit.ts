/**
 * Generic fixed-window, in-memory rate limiter. No login-specific logic: callers supply a key
 * and a config. State is per process and lost on restart (documented trade-off, single container).
 * Memory is bounded: expired entries are pruned on a schedule and the map is hard-capped.
 */

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
  /** Hard cap on tracked keys; oldest entries are evicted beyond it. */
  maxKeys?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Whole seconds until the window resets (>= 1 when blocked). */
  retryAfterSec: number;
}

export interface RateLimiter {
  /** Counts one attempt for `key` and reports whether it is within the limit. */
  hit(key: string): RateLimitResult;
  /** Gives back one counted attempt (e.g. a login that turned out to succeed). */
  refund(key: string): void;
  /** Forgets a key (e.g. after a successful login). */
  reset(key: string): void;
  /** Number of tracked keys (for tests and metrics). */
  size(): number;
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000, now = Date.now } = config;
  const entries = new Map<string, { count: number; resetAt: number }>();
  let nextPrune = 0;

  function prune(t: number) {
    for (const [k, e] of entries) if (e.resetAt <= t) entries.delete(k);
    nextPrune = t + windowMs;
  }

  return {
    hit(key) {
      const t = now();
      if (t >= nextPrune) prune(t);
      let e = entries.get(key);
      if (!e || e.resetAt <= t) {
        e = { count: 0, resetAt: t + windowMs };
        entries.delete(key); // re-insert so Map order tracks creation time
        entries.set(key, e);
        if (entries.size > maxKeys) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) entries.delete(oldest);
        }
      }
      e.count += 1;
      const retryAfterSec = Math.max(1, Math.ceil((e.resetAt - t) / 1000));
      if (e.count > limit) return { allowed: false, remaining: 0, retryAfterSec };
      return { allowed: true, remaining: limit - e.count, retryAfterSec };
    },
    refund(key) {
      const e = entries.get(key);
      if (e && e.count > 0) e.count -= 1;
    },
    reset(key) {
      entries.delete(key);
    },
    size: () => entries.size,
  };
}

const registry = globalThis as unknown as { __rateLimiters?: Map<string, RateLimiter> };

/**
 * Process-wide named limiter. Stored on globalThis so separately bundled route modules share it.
 * The config of the first call for a name wins.
 */
export function getRateLimiter(name: string, config: RateLimitConfig): RateLimiter {
  const map = (registry.__rateLimiters ??= new Map());
  let l = map.get(name);
  if (!l) map.set(name, (l = createRateLimiter(config)));
  return l;
}

/** 429 response with Retry-After. `message` is a caller-supplied (translated) body. */
export function tooManyRequests(retryAfterSec: number, message: string): Response {
  return new Response(message, {
    status: 429,
    headers: {
      'Retry-After': String(retryAfterSec),
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
