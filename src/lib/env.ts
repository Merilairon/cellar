import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

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
    ),
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
