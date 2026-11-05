/**
 * Tiny in-process concurrency limiter for outbound fetches and image decodes, on top of the
 * per-user rate limit: a burst from many users cannot open unbounded sockets or decode
 * unbounded images. Excess callers wait in FIFO order, but the queue is bounded and a
 * waiter gives up after `waitMs`, so a request never hangs behind a long line.
 */
export class LimiterBusyError extends Error {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super('limiter_busy');
    this.name = 'LimiterBusyError';
    this.retryAfterSec = retryAfterSec;
  }
}

/** 503 with Retry-After for a busy limiter. */
export function busyResponse(e: LimiterBusyError): Response {
  return Response.json(
    { error: 'busy' },
    {
      status: 503,
      headers: { 'Retry-After': String(e.retryAfterSec), 'Cache-Control': 'no-store' },
    },
  );
}

export type LimiterOptions = { maxQueue?: number; waitMs?: number; retryAfterSec?: number };

export function createConcurrencyLimiter(max: number, opts: LimiterOptions = {}) {
  const { maxQueue = Infinity, waitMs = Infinity, retryAfterSec = 5 } = opts;
  let active = 0;
  type Waiter = { go: () => void; timer?: ReturnType<typeof setTimeout> };
  const waiting: Waiter[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      if (waiting.length >= maxQueue) throw new LimiterBusyError(retryAfterSec);
      await new Promise<void>((resolve, reject) => {
        const w: Waiter = { go: resolve };
        if (Number.isFinite(waitMs)) {
          w.timer = setTimeout(() => {
            waiting.splice(waiting.indexOf(w), 1);
            reject(new LimiterBusyError(retryAfterSec));
          }, waitMs);
        }
        waiting.push(w);
      });
    } else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.go(); // hand the slot over without releasing it
      } else active--;
    }
  };
}

export const FETCH_CONCURRENCY = 4;
export const FETCH_MAX_QUEUE = 16;
export const FETCH_WAIT_MS = 15_000;
/** Image decodes are memory-heavy (RGBA of up to 16 MP): one at a time. */
export const DECODE_CONCURRENCY = 1;
export const DECODE_MAX_QUEUE = 4;
export const DECODE_WAIT_MS = 15_000;

type Limiter = ReturnType<typeof createConcurrencyLimiter>;
const registry = globalThis as unknown as {
  __importFetchLimiter?: Limiter;
  __importDecodeLimiter?: Limiter;
};

/** Process-wide limiters shared by separately bundled route modules. */
export const limitFetch: Limiter = (fn) =>
  (registry.__importFetchLimiter ??= createConcurrencyLimiter(FETCH_CONCURRENCY, {
    maxQueue: FETCH_MAX_QUEUE,
    waitMs: FETCH_WAIT_MS,
  }))(fn);

export const limitDecode: Limiter = (fn) =>
  (registry.__importDecodeLimiter ??= createConcurrencyLimiter(DECODE_CONCURRENCY, {
    maxQueue: DECODE_MAX_QUEUE,
    waitMs: DECODE_WAIT_MS,
  }))(fn);
