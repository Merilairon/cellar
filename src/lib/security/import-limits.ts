import { getEnv } from '@/lib/env';
import { getRateLimiter } from './rate-limit';

/** Per-user limiter for POST /api/import (env: RATE_LIMIT_IMPORT_MAX / _WINDOW_SEC). */
export function importLimiter() {
  const e = getEnv();
  return getRateLimiter('import:user', {
    limit: e.RATE_LIMIT_IMPORT_MAX,
    windowMs: e.RATE_LIMIT_IMPORT_WINDOW_SEC * 1000,
  });
}
