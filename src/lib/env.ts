import { z } from 'zod';
import { isValidProxyEntry } from '@/lib/security/proxy-trust';

const isProd = process.env.NODE_ENV === 'production';

const posInt = (def: number) => z.coerce.number().int().positive().default(def);

function rateLimitShape() {
  return {
    RATE_LIMIT_LOGIN_MAX: posInt(20), // per client IP
    RATE_LIMIT_LOGIN_EMAIL_MAX: posInt(10), // per account email
    RATE_LIMIT_LOGIN_WINDOW_SEC: posInt(900),
    RATE_LIMIT_REGISTER_MAX: posInt(10), // invite registration, reset and setup POSTs, per IP
    RATE_LIMIT_REGISTER_WINDOW_SEC: posInt(3600),
  };
}

const schema = z.object({
  DATABASE_PATH: z.string().min(1).default('/data/app.db'),
  SESSION_SECRET: z.string().min(32),
  BASE_URL: (isProd ? z.url() : z.url().default('http://localhost:3000')).refine(
    (v) => new URL(v).pathname === '/' && !v.endsWith('/'),
    'BASE_URL must have no path and no trailing slash',
  ),
  TRUSTED_PROXIES: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine(
      (l) => l.every(isValidProxyEntry),
      'TRUSTED_PROXIES must be comma-separated IPs or CIDRs',
    ),
  ...rateLimitShape(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source);
}

let cached: Env | undefined;

/** Lazily parsed typed env. Server-only. */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
