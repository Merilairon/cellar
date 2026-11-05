import { dirname, join } from 'node:path';
import { z } from 'zod';
import { isValidProxyEntry } from '@/lib/security/proxy-trust';

const isProd = process.env.NODE_ENV === 'production';
// The SSRF-guard seam is fail-closed: only explicit dev/test runs may enable it.
const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

const PLACEHOLDER_SECRETS = new Set(['changeme', 'replace-with-at-least-32-random-characters']);

function isPlaceholderSecret(v: string): boolean {
  const l = v.toLowerCase();
  return (
    PLACEHOLDER_SECRETS.has(l) || /^replace-with|^change-?me|^your-/.test(l) || /^(.)\1*$/.test(v)
  );
}

/** Env booleans: only the literal strings below count; "false" must not be truthy. */
const envBool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const posInt = (def: number) => z.coerce.number().int().positive().default(def);

function rateLimitShape() {
  return {
    RATE_LIMIT_LOGIN_MAX: posInt(20), // per client IP
    RATE_LIMIT_LOGIN_EMAIL_MAX: posInt(10), // per account email
    RATE_LIMIT_LOGIN_WINDOW_SEC: posInt(900),
    RATE_LIMIT_REGISTER_MAX: posInt(10), // invite registration, reset and setup POSTs, per IP
    RATE_LIMIT_REGISTER_WINDOW_SEC: posInt(3600),
    RATE_LIMIT_IMPORT_MAX: posInt(20), // POST /api/import, per user
    RATE_LIMIT_IMPORT_WINDOW_SEC: posInt(3600),
  };
}

const schema = z.object({
  DATABASE_PATH: z.string().min(1).default('/data/app.db'),
  SESSION_SECRET: z
    .string()
    .min(32)
    .refine(
      (v) => !isProd || !isPlaceholderSecret(v),
      'SESSION_SECRET is a known placeholder; set a random value (e.g. openssl rand -base64 48)',
    ),
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
  // Import: keep the fetched/pasted HTML on disk (never auto-deleted). Off by default.
  KEEP_RAW_HTML: envBool,
  // Directory for photos; defaults to <dir of DATABASE_PATH>/uploads (/data/uploads in Docker).
  UPLOADS_DIR: z.string().min(1).optional(),
  // Non-production seam: let the importer fetch private addresses and non-80/443 ports
  // (local fixture server for tests). It disables the SSRF guard, so production refuses it.
  IMPORT_ALLOW_LOCAL_FETCH: envBool.refine(
    (v) => isDevOrTest || !v,
    'IMPORT_ALLOW_LOCAL_FETCH is only allowed when NODE_ENV is development or test',
  ),
});

const schemaWithDerived = schema.transform((e) => ({
  ...e,
  UPLOADS_DIR: e.UPLOADS_DIR ?? join(dirname(e.DATABASE_PATH), 'uploads'),
}));

export type Env = z.infer<typeof schemaWithDerived>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schemaWithDerived.parse(source);
}

let cached: Env | undefined;

/** Lazily parsed typed env. Server-only. */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
