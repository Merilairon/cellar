import { getEnv } from '@/lib/env';
import { createTrustMatcher, resolveClient, type TrustMatcher } from './proxy-trust';

/** Shared key when no trustworthy client address exists (fail closed, see proxy-trust.ts). */
export const UNKNOWN_CLIENT = 'unknown';

let cache: { key: string; matcher: TrustMatcher } | undefined;

/** Trusted client IP for a request's headers; UNKNOWN_CLIENT when none can be trusted. */
export function getClientIp(headers: { get(name: string): string | null }): string {
  const entries = getEnv().TRUSTED_PROXIES;
  const key = entries.join(',');
  if (cache?.key !== key) cache = { key, matcher: createTrustMatcher(entries) };
  const r = resolveClient(
    {
      forwardedFor: headers.get('x-forwarded-for'),
      forwardedProto: headers.get('x-forwarded-proto'),
    },
    entries,
    cache.matcher,
  );
  return r.ip ?? UNKNOWN_CLIENT;
}
