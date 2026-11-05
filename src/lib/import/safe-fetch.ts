import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { ImportError } from './errors';
import { isBlockedHostname, isBlockedIp, isIpLiteral } from './ip-guard';

export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;
const MAX_URL_LENGTH = 2048;

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type TransportRequest = {
  url: URL;
  /** The validated address to connect to. The transport must connect here and nowhere else. */
  ip: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
};
export type TransportResponse = {
  status: number;
  headers: Record<string, string>;
  /** Raw (possibly content-encoded) body chunks. */
  body: AsyncIterable<Uint8Array>;
  destroy?: () => void;
};
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export type SafeFetchOptions = {
  /** `html` for pages (default), `image` for cover images. */
  accept?: 'html' | 'image';
  userAgent?: string;
  maxBytes?: number;
  timeoutMs?: number;
  resolve?: Resolver;
  transport?: Transport;
  /**
   * Non-production seam for fetching local fixtures: allows private addresses and
   * non-80/443 ports. Rejected in production by env parsing (IMPORT_ALLOW_LOCAL_FETCH);
   * callers must take this value from getEnv(), never from user input.
   */
  allowLocal?: boolean;
};

export type SafeFetchResult = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  finalUrl: string;
};

const defaultResolve: Resolver = async (hostname) => {
  const all = await dnsLookup(hostname, { all: true, verbatim: true });
  return all.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

const defaultTransport: Transport = ({ url, ip, family, headers, signal }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const req = mod.request(
      {
        host,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { ...headers, Host: url.host },
        agent: false,
        signal,
        // DNS pinning: the socket connects to the already validated address.
        // Host header and TLS SNI keep the original hostname.
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          if (opts?.all) cb(null, [{ address: ip, family }]);
          else cb(null, ip, family);
        }) as never,
        ...(isIpLiteral(host) ? {} : { servername: host }),
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
    req.end();
  });

const REDIRECT = new Set([301, 302, 303, 307, 308]);

function parseUrl(raw: string, allowLocal: boolean): URL {
  if (raw.length > MAX_URL_LENGTH) throw new ImportError('invalid_url');
  let u: URL;
  try {
    u = new URL(raw); // WHATWG parsing canonicalizes decimal/octal/hex/short IPv4 and IPv6
  } catch {
    throw new ImportError('invalid_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ImportError('invalid_url');
  if (u.username || u.password) throw new ImportError('invalid_url');
  if (!u.hostname) throw new ImportError('invalid_url');
  if (!allowLocal && u.port !== '') throw new ImportError('invalid_url'); // default ports normalize to ''; others are rejected
  u.hash = '';
  return u;
}

async function pickAddress(
  u: URL,
  resolve: Resolver,
  allowLocal: boolean,
): Promise<ResolvedAddress> {
  const host = u.hostname;
  if (isIpLiteral(host)) {
    const address = host.replace(/^\[|\]$/g, '');
    if (!allowLocal && isBlockedIp(address)) throw new ImportError('private_address');
    return { address, family: address.includes(':') ? 6 : 4 };
  }
  if (!allowLocal && isBlockedHostname(host)) throw new ImportError('private_address');
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolve(host);
  } catch (e) {
    throw new ImportError('fetch_failed', e);
  }
  if (addrs.length === 0) throw new ImportError('fetch_failed');
  // Every record must be public: a mixed answer is rejected, not filtered.
  if (!allowLocal && addrs.some((a) => isBlockedIp(a.address))) {
    throw new ImportError('private_address');
  }
  return addrs[0]!;
}

function decoderFor(enc: string | undefined) {
  switch ((enc ?? '').trim().toLowerCase()) {
    case '':
    case 'identity':
      return null;
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      throw new ImportError('fetch_failed');
  }
}

/** Reads and decodes the body, counting both wire bytes and decoded bytes against the cap. */
async function readBody(
  body: AsyncIterable<Uint8Array>,
  encoding: string | undefined,
  max: number,
): Promise<Uint8Array> {
  let wire = 0;
  async function* counted() {
    for await (const c of body) {
      wire += c.length;
      if (wire > max) throw new ImportError('too_large');
      yield c;
    }
  }
  const decoder = decoderFor(encoding);
  const collect = async (src: AsyncIterable<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const c of src) {
      total += c.length;
      if (total > max) throw new ImportError('too_large'); // decoded size (bomb guard)
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  };
  try {
    if (!decoder) return await collect(counted());
    return await pipeline(Readable.from(counted()), decoder, collect);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('fetch_failed', e);
  }
}

const ACCEPT = {
  html: {
    header: 'text/html,application/xhtml+xml;q=0.9',
    ok: /^(text\/html|application\/xhtml\+xml)\b/i,
  },
  image: {
    header: 'image/jpeg,image/png,image/webp,image/gif',
    ok: /^image\/(jpeg|png|webp|gif)\b/i,
  },
} as const;

/**
 * Fetch a user-supplied URL without ever contacting a blocked address.
 * Every hop is parsed, DNS-resolved once, checked against every resolved address,
 * and then connected to by pinned IP. Redirects are followed manually (max 5).
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const {
    accept = 'html',
    userAgent = 'CellarBot/0.3 (recipe importer)',
    maxBytes = MAX_BYTES,
    timeoutMs = TIMEOUT_MS,
    resolve = defaultResolve,
    transport = defaultTransport,
    allowLocal = false,
  } = opts;

  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new ImportError('timeout'));
    }, timeoutMs);
  });

  const run = async (): Promise<SafeFetchResult> => {
    let current = parseUrl(rawUrl, allowLocal);
    for (let hop = 0; ; hop++) {
      const addr = await pickAddress(current, resolve, allowLocal);
      let res: TransportResponse;
      try {
        res = await transport({
          url: current,
          ip: addr.address,
          family: addr.family,
          signal: ctl.signal,
          headers: {
            'User-Agent': userAgent,
            Accept: ACCEPT[accept].header,
            'Accept-Encoding': 'gzip, deflate, br',
          },
        });
      } catch (e) {
        if (e instanceof ImportError) throw e;
        throw new ImportError('fetch_failed', e);
      }
      ctl.signal.addEventListener('abort', () => res.destroy?.(), { once: true });

      if (REDIRECT.has(res.status)) {
        res.destroy?.();
        const loc = res.headers['location'];
        if (!loc) throw new ImportError('fetch_failed');
        if (hop >= MAX_REDIRECTS) throw new ImportError('fetch_failed');
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          throw new ImportError('invalid_url');
        }
        current = parseUrl(next.href, allowLocal); // re-validates scheme, userinfo, port
        continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        res.destroy?.();
        throw new ImportError('blocked');
      }
      if (res.status < 200 || res.status >= 300) {
        res.destroy?.();
        throw new ImportError('fetch_failed');
      }
      const ctype = res.headers['content-type'] ?? '';
      if (!ACCEPT[accept].ok.test(ctype)) {
        res.destroy?.();
        throw new ImportError('fetch_failed');
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy?.();
        throw new ImportError('too_large');
      }
      const body = await readBody(res.body, res.headers['content-encoding'], maxBytes);
      return { status: res.status, headers: res.headers, body, finalUrl: current.href };
    }
  };

  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}
