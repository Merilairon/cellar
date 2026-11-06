import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config.ts';
import { launchBrowser } from './browser.ts';
import { selfCheck } from './sandbox.ts';
import { Supervisor } from './supervisor.ts';

export const MAX_BODY_BYTES = 2048;

export type RenderRequest = { url: string; waitMs?: number };
export type RenderResult = {
  html: string;
  finalUrl: string;
  status: number;
  /** Count of blocked sub-requests (never their targets). */
  warnings?: number;
};
export type ErrorCode = 'blocked' | 'timeout' | 'private_address' | 'too_large' | 'failed';

/** Thrown by a renderer to produce a specific error response (T4 maps its outcomes here). */
export class RenderError extends Error {
  code: ErrorCode;
  httpStatus: number;
  constructor(code: ErrorCode, httpStatus = 502) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type Renderer = (req: RenderRequest, cfg: Config) => Promise<RenderResult>;

// T2 skeleton: rendering is implemented in T3/T4. Until then every render fails closed.
const notImplemented: Renderer = async () => {
  throw new RenderError('failed', 503);
};

function sha(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

/** Constant-time comparison of the Authorization header against the configured token. */
export function tokenOk(header: string | undefined, token: string | null): boolean {
  if (token === null) return true;
  const m = /^Bearer (.+)$/.exec(header ?? '');
  const given = m ? m[1] : '';
  // Hash both sides so lengths are equal and the compare time does not depend on the token.
  const equal = timingSafeEqual(sha(given), sha(token));
  return equal && m !== null;
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'close',
    ...extra,
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY_BYTES) return resolve('too_large');
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        req.pause();
        resolve('too_large');
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseRender(raw: Buffer): RenderRequest | null {
  let v: unknown;
  try {
    v = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  // Only url and waitMs exist; anything else (headers, cookies, scripts) is rejected.
  for (const k of Object.keys(o)) if (k !== 'url' && k !== 'waitMs') return null;
  if (typeof o.url !== 'string' || o.url.length === 0 || o.url.length > 2000) return null;
  if (o.waitMs !== undefined) {
    if (
      typeof o.waitMs !== 'number' ||
      !Number.isInteger(o.waitMs) ||
      o.waitMs < 0 ||
      o.waitMs > 10_000
    ) {
      return null;
    }
  }
  return { url: o.url, ...(o.waitMs !== undefined ? { waitMs: o.waitMs } : {}) };
}

export type ServerOptions = {
  config: Config;
  render?: Renderer;
  /** Readiness: false until the sandbox self-check has passed. */
  ready?: () => boolean;
};

export function createSidecar(opts: ServerOptions): Server {
  const { config } = opts;
  const render = opts.render ?? notImplemented;
  const ready = opts.ready ?? (() => true);
  let active = 0;

  return createServer(async (req, res) => {
    try {
      const path = (req.url ?? '').split('?')[0];
      if (path === '/healthz') {
        if (req.method !== 'GET') return send(res, 405, { error: 'failed' }, { allow: 'GET' });
        return ready() ? send(res, 200, { ok: true }) : send(res, 503, { ok: false });
      }
      if (path !== '/render') return send(res, 404, { error: 'failed' });
      if (req.method !== 'POST') return send(res, 405, { error: 'failed' }, { allow: 'POST' });

      // Auth first: a bad token does no work and its body is never read.
      if (!tokenOk(req.headers.authorization, config.token)) {
        return send(res, 401, { error: 'failed' }, { 'www-authenticate': 'Bearer' });
      }
      if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
        return send(res, 415, { error: 'failed' });
      }
      const body = await readBody(req);
      if (body === 'too_large') return send(res, 413, { error: 'too_large' });
      const parsed = parseRender(body);
      if (!parsed) return send(res, 400, { error: 'failed' });
      if (!ready() || active >= config.maxConcurrentRenders)
        return send(res, 503, { error: 'failed' });

      active++;
      try {
        const out = await render(parsed, config);
        return send(res, 200, out);
      } finally {
        active--;
      }
    } catch (err) {
      if (err instanceof RenderError) return send(res, err.httpStatus, { error: err.code });
      // Never leak internals to the caller.
      if (!res.headersSent) send(res, 500, { error: 'failed' });
    }
  });
}

async function main() {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (config.noToken)
    console.warn('WARNING: running without HEADLESS_TOKEN (HEADLESS_ALLOW_NO_TOKEN=1)');
  let isReady = false;
  try {
    const { version } = await selfCheck(() => launchBrowser());
    console.log(`sandbox self-check ok, chromium ${version}, uid ${process.getuid?.()}`);
    isReady = true;
  } catch (err) {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const supervisor = new Supervisor(config);
  const server = createSidecar({
    config,
    render: (r) => supervisor.render(r),
    ready: () => isReady,
  });
  server.listen(config.port, config.bindAddr, () =>
    console.log(`browser sidecar listening on ${config.bindAddr}:${config.port}`),
  );
  for (const sig of ['SIGTERM', 'SIGINT'] as const)
    process.on(sig, () => {
      server.close();
      void supervisor.shutdown().finally(() => process.exit(0));
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
