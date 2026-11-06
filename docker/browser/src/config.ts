// Sidecar configuration. Reads only the variables listed here; nothing else from the
// environment is used, and the only secret is the optional HEADLESS_TOKEN.

export const HARD_MAX_RENDER_TIMEOUT_MS = 30_000;

export type Config = {
  port: number;
  bindAddr: string;
  token: string | null;
  /** True when the operator explicitly allowed running without a token. */
  noToken: boolean;
  renderTimeoutMs: number;
  maxConcurrentRenders: number;
  maxTotalBytes: number;
  maxSubRequests: number;
  maxRedirects: number;
};

function int(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d{1,12}$/.test(raw)) throw new Error(`${name} must be a non-negative integer`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.HEADLESS_TOKEN ? env.HEADLESS_TOKEN : null;
  if (token !== null && !/^[A-Za-z0-9+/_=-]{32,}$/.test(token)) {
    throw new Error(
      'HEADLESS_TOKEN must be 32+ hex/base64 characters (for example openssl rand -hex 32)',
    );
  }
  // Threat model R7: fail closed without a token unless the operator opts out explicitly.
  if (token === null && env.HEADLESS_ALLOW_NO_TOKEN !== '1') {
    throw new Error(
      'HEADLESS_TOKEN is required (set HEADLESS_ALLOW_NO_TOKEN=1 to run without one)',
    );
  }
  return {
    port: int(env, 'PORT', 3001, 1, 65535),
    bindAddr: env.BIND_ADDR || '0.0.0.0',
    token,
    noToken: token === null,
    // Clamped: the 30 s ceiling is a security control and cannot be raised by configuration.
    renderTimeoutMs: Math.min(
      int(env, 'RENDER_TIMEOUT_MS', HARD_MAX_RENDER_TIMEOUT_MS, 1000, 3_600_000),
      HARD_MAX_RENDER_TIMEOUT_MS,
    ),
    maxConcurrentRenders: int(env, 'MAX_CONCURRENT_RENDERS', 1, 1, 8),
    maxTotalBytes: int(env, 'MAX_TOTAL_BYTES', 15 * 1024 * 1024, 1024, 256 * 1024 * 1024),
    maxSubRequests: int(env, 'MAX_SUB_REQUESTS', 150, 1, 10_000),
    maxRedirects: int(env, 'MAX_REDIRECTS', 5, 0, 20),
  };
}
