import http from 'node:http';
import { z } from 'zod';
import { ImportError } from './errors';
import { createConcurrencyLimiter, LimiterBusyError } from './limiter';
import { assertPublicTarget } from './safe-fetch';

// App-side client for the optional headless sidecar (docker/browser). The only other place
// that touches the network besides safe-fetch.ts. The sidecar is an untrusted, authenticated
// peer: its response is size-capped while streaming, content-type checked, zod-validated and
// mapped to fixed ImportError codes. Its text is never forwarded; the token and the HTML are
// never logged. The target is operator config (env), never request data.

/** Page HTML cap, same as the static fetch. */
export const MAX_RENDER_HTML = 5 * 1024 * 1024;
/**
 * Wire cap for the JSON envelope: JSON escaping of a 5 MiB DOM can grow it, so allow headroom;
 * the decoded `html` is still held to MAX_RENDER_HTML. An endless response is cut here (C18).
 */
export const MAX_RENDER_WIRE = 8 * 1024 * 1024;
/** Small cap for error bodies. */
const MAX_ERROR_WIRE = 16 * 1024;

export type HeadlessConfig = {
  /** Bare http origin of the sidecar (validated by env parsing). */
  url: string;
  token?: string;
  timeoutMs: number;
};

export type HeadlessPage = {
  html: string;
  /** Validated against the URL policy before being returned. */
  finalUrl: string;
  status: number;
};

export type HeadlessTransportRequest = {
  url: URL;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};
export type HeadlessTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  destroy?: () => void;
};
export type HeadlessTransport = (
  req: HeadlessTransportRequest,
) => Promise<HeadlessTransportResponse>;

export type HeadlessDeps = {
  transport?: HeadlessTransport;
  /** Pre-check of the entered URL and the sidecar's finalUrl (defaults to the safe-fetch policy). */
  assertPublic?: (url: string) => Promise<unknown>;
  /** Mirrors IMPORT_ALLOW_LOCAL_FETCH for the default pre-check (non-production only). */
  allowLocal?: boolean;
  log?: (msg: string, err?: unknown) => void;
};

/** Handle used by the pipeline: `enabled` false means "never call render". */
export type Headless = {
  enabled: boolean;
  render: (url: string) => Promise<HeadlessPage>;
};

export function isHeadlessEnabled(config: HeadlessConfig | null | undefined): boolean {
  return !!config?.url;
}

/** Fixed envelope; unknown keys are ignored, `warnings` (T4) is an optional count. */
const okSchema = z.object({
  html: z.string(),
  finalUrl: z.string().min(1).max(2048),
  status: z.number().int().min(100).max(599),
  warnings: z.number().int().nonnegative().optional(),
});
const errSchema = z.object({
  error: z.enum(['blocked', 'timeout', 'private_address', 'too_large', 'failed']),
});

const defaultTransport: HeadlessTransport = ({ url, headers, body, signal }) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || 80,
        path: '/render',
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        agent: false,
        signal,
      },
      (res) => {
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: h,
          body: res,
          destroy: () => res.destroy(),
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });

const unavailable = (cause?: unknown) => new ImportError('headless_unavailable', cause);

/** Reads at most `max` bytes, then aborts and fails: an endless body cannot exhaust memory. */
async function readCapped(res: HeadlessTransportResponse, max: number): Promise<Buffer> {
  const declared = Number(res.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) {
    res.destroy?.();
    throw unavailable('declared length over cap');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const c of res.body) {
      total += c.length;
      if (total > max) {
        res.destroy?.();
        throw unavailable('response over cap');
      }
      chunks.push(c);
    }
  } catch (e) {
    res.destroy?.();
    throw e instanceof ImportError ? e : unavailable(e);
  }
  return Buffer.concat(chunks);
}

const SIDECAR_ERROR_TO_CODE = {
  blocked: 'blocked',
  timeout: 'timeout',
  private_address: 'private_address',
  too_large: 'too_large',
  failed: 'headless_unavailable',
} as const;

// One render at a time across the process (G12). No queue: a second caller gets
// headless_unavailable at once instead of waiting behind a 30 s job.
const registry = globalThis as unknown as {
  __headlessLimiter?: ReturnType<typeof createConcurrencyLimiter>;
};
const limit = <T>(fn: () => Promise<T>) =>
  (registry.__headlessLimiter ??= createConcurrencyLimiter(1, { maxQueue: 0 }))(fn);

/**
 * Renders `url` in the sidecar. Never throws anything but ImportError:
 * blocked, timeout, private_address, too_large pass through from the sidecar;
 * everything else (down, busy, 401/5xx, malformed, oversize, slow) is headless_unavailable.
 */
export async function renderPage(
  url: string,
  config: HeadlessConfig,
  deps: HeadlessDeps = {},
): Promise<HeadlessPage> {
  const {
    transport = defaultTransport,
    allowLocal = false,
    assertPublic = (u: string) => assertPublicTarget(u, { allowLocal }),
    log,
  } = deps;
  try {
    return await limit(() => renderInner(url, config, transport, assertPublic, log));
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof LimiterBusyError) throw unavailable('busy');
    throw unavailable(e);
  }
}

async function renderInner(
  url: string,
  config: HeadlessConfig,
  transport: HeadlessTransport,
  assertPublic: (u: string) => Promise<unknown>,
  log?: HeadlessDeps['log'],
): Promise<HeadlessPage> {
  if (!isHeadlessEnabled(config)) throw unavailable('not configured');
  // G7: the entered URL must pass the app's own policy before the browser sees it.
  await assertPublic(url);

  let target: URL;
  try {
    target = new URL(config.url);
  } catch (e) {
    throw unavailable(e);
  }
  log?.(`headless render host=${safeHost(url)}`); // host only: no path, query, token or HTML

  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(unavailable('client timeout'));
    }, config.timeoutMs);
  });

  const run = async (): Promise<HeadlessPage> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
    let res: HeadlessTransportResponse;
    try {
      res = await transport({
        url: target,
        headers,
        body: JSON.stringify({ url }), // nothing else is ever sent
        signal: ctl.signal,
      });
    } catch (e) {
      throw unavailable(e);
    }
    const onAbort = () => res.destroy?.();
    ctl.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (!/^application\/json\s*(;|$)/i.test(res.headers['content-type'] ?? '')) {
        res.destroy?.();
        throw unavailable('content type');
      }
      if (res.headers['content-encoding']) {
        res.destroy?.();
        throw unavailable('content encoding'); // we never ask for compression
      }
      const ok = res.status === 200;
      const raw = await readCapped(res, ok ? MAX_RENDER_WIRE : MAX_ERROR_WIRE);
      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch (e) {
        throw unavailable(e);
      }
      if (!ok) {
        const err = errSchema.safeParse(json);
        if (!err.success) throw unavailable('unknown error shape');
        throw new ImportError(SIDECAR_ERROR_TO_CODE[err.data.error]);
      }
      const page = okSchema.safeParse(json);
      if (!page.success) throw unavailable('bad response shape');
      const { html, finalUrl, status } = page.data;
      if (html.length > MAX_RENDER_HTML) throw new ImportError('too_large');
      // The sidecar is untrusted: its finalUrl goes through the same URL policy.
      let validated: string;
      try {
        validated = ((await assertPublic(finalUrl)) as URL | undefined)?.href ?? finalUrl;
      } catch (e) {
        if (e instanceof ImportError && e.code === 'private_address') throw e;
        throw unavailable(e); // malformed or unresolvable finalUrl: the response is not trusted
      }
      if (status === 401 || status === 403 || status === 429) throw new ImportError('blocked');
      if (status < 200 || status >= 300) throw new ImportError('fetch_failed');
      return { html, finalUrl: validated, status };
    } finally {
      ctl.signal.removeEventListener('abort', onAbort);
    }
  };

  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

/** Builds the pipeline handle from env-derived config; disabled (and inert) when unset. */
export function createHeadless(
  config: HeadlessConfig | null | undefined,
  deps: HeadlessDeps = {},
): Headless {
  if (!config || !isHeadlessEnabled(config)) {
    return {
      enabled: false,
      render: () => Promise.reject(unavailable('not configured')),
    };
  }
  return { enabled: true, render: (url) => renderPage(url, config, deps) };
}
