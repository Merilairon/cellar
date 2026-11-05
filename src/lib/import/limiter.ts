/**
 * Tiny in-process concurrency limiter for outbound fetches (page and cover downloads), on
 * top of the per-user rate limit: a burst from many users cannot open unbounded sockets.
 * Excess callers wait in FIFO order (each fetch is itself bounded by a 10 s timeout).
 */
export function createConcurrencyLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next)
        next(); // hand the slot over without releasing it
      else active--;
    }
  };
}

export const FETCH_CONCURRENCY = 4;

const registry = globalThis as unknown as {
  __importFetchLimiter?: ReturnType<typeof createConcurrencyLimiter>;
};

/** Process-wide limiter shared by separately bundled route modules. */
export const limitFetch: ReturnType<typeof createConcurrencyLimiter> = (fn) =>
  (registry.__importFetchLimiter ??= createConcurrencyLimiter(FETCH_CONCURRENCY))(fn);
