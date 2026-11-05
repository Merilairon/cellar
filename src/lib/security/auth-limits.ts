import { getTranslations } from 'next-intl/server';
import { getEnv } from '@/lib/env';
import { getClientIp, UNKNOWN_CLIENT } from './request-client';
import { getRateLimiter, tooManyRequests, type RateLimiter } from './rate-limit';

/** Env-configured limiters for the auth endpoints. Thin glue; the logic lives in rate-limit.ts. */
export function authLimiters() {
  const e = getEnv();
  const login = { windowMs: e.RATE_LIMIT_LOGIN_WINDOW_SEC * 1000 };
  const reg = {
    limit: e.RATE_LIMIT_REGISTER_MAX,
    windowMs: e.RATE_LIMIT_REGISTER_WINDOW_SEC * 1000,
  };
  return {
    loginIp: getRateLimiter('login:ip', { ...login, limit: e.RATE_LIMIT_LOGIN_MAX }),
    loginEmail: getRateLimiter('login:email', { ...login, limit: e.RATE_LIMIT_LOGIN_EMAIL_MAX }),
    register: getRateLimiter('register:ip', reg),
    reset: getRateLimiter('reset:ip', reg),
    setup: getRateLimiter('setup:ip', reg),
  };
}

export { getClientIp };

/**
 * Per-IP variant. When no trustworthy client address exists (TRUSTED_PROXIES empty or the peer
 * untrusted) every visitor would share the single 'unknown' bucket, so a few bad requests would
 * lock everybody out. In that case the per-IP limit is skipped; per-email limits and the
 * unguessable-token requirement of register/reset still apply.
 */
export async function limitClientOrResponse(
  limiter: RateLimiter,
  ip: string,
): Promise<Response | null> {
  return ip === UNKNOWN_CLIENT ? null : limitOrResponse(limiter, ip);
}

/** Hits `limiter` for `key`; returns a 429 Response when over the limit, otherwise null. */
export async function limitOrResponse(limiter: RateLimiter, key: string): Promise<Response | null> {
  const r = limiter.hit(key);
  if (r.allowed) return null;
  const t = await getTranslations();
  return tooManyRequests(r.retryAfterSec, t('errors.rateLimited'));
}
