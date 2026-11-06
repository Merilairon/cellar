// Per-job filtering forward proxy (threat model R3, R4, R9, R10). Chromium is forced through
// it, so this is the one place where hostnames are resolved and addresses are checked.
// DNS pinning: each host is resolved exactly once per job; every connection for that host
// (any hop, resource or retry) uses only the validated address set. Fail closed everywhere,
// and never reflect targets or resolver text in a response.
import http from 'node:http';
import net from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isBlockedHostname, isBlockedIp, isIpLiteral } from './ip-guard.ts';

export type Addr = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<Addr[]>;
export type Connector = (addr: Addr, port: number) => Promise<net.Socket>;

export const defaultResolve: Resolver = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

const CONNECT_TIMEOUT_MS = 10_000;
const defaultConnect: Connector = (addr, port) =>
  new Promise((resolve, reject) => {
    const s = net.connect({ host: addr.address, port, family: addr.family });
    const t = setTimeout(
      () => s.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })),
      CONNECT_TIMEOUT_MS,
    );
    s.once('connect', () => {
      clearTimeout(t);
      s.removeAllListeners('error');
      resolve(s);
    });
    s.once('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });

/** Connect-level failures after which the next already-validated address may be tried (m9). */
const FALLBACK = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

export class ProxyBlocked extends Error {}

export type ProxyStats = {
  requests: number;
  bytes: number;
  /** Requests refused by the address/host guard (target hosts are never recorded). */
  blockedPrivate: number;
  /** Other refusals (bad port, scheme, parsing, upgrade). */
  blockedPolicy: number;
  overBytes: boolean;
  overRequests: boolean;
  /** Resolver calls per host: must never exceed 1. */
  resolves: Map<string, number>;
  /** Connection attempts that reached the connector. */
  connects: number;
};

/** Test-only seam, injected by tests, never read from the environment. */
export type TestOverrides = {
  allowAddress?: (ip: string) => boolean;
  allowPorts?: readonly number[];
};

export type ProxyOptions = {
  resolve?: Resolver;
  connect?: Connector;
  maxBytes: number;
  maxRequests: number;
  maxTunnels?: number;
  idleMs?: number;
  testOverrides?: TestOverrides;
};

export type JobProxy = { port: number; stats: ProxyStats; close: () => Promise<void> };

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'via',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);
const BAD_CHARS = /[\x00-\x08\x0a-\x1f\x7f]/;

/** Canonical lowercase host (via the URL parser, so decimal/hex/short IPv4 forms normalize). */
export function canonicalHost(raw: string): string | null {
  if (
    raw === '' ||
    (!raw.startsWith('[') && raw.includes(':')) ||
    BAD_CHARS.test(raw) ||
    /[\s@\\/?#%]/.test(raw)
  )
    return null;
  try {
    const u = new URL(`http://${raw}/`);
    if (u.username || u.password || u.port || !u.hostname) return null;
    return u.hostname.replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** CONNECT authority: exactly host:443, nothing else (R10). */
export function parseConnectTarget(target: string): { host: string; port: 443 } | null {
  const m = /^(\[[0-9a-fA-F:.]+\]|[^:\s[\]]+):(443)$/.exec(target);
  if (!m) return null;
  const host = canonicalHost(m[1]!);
  return host ? { host, port: 443 } : null;
}

/** Headers that make a request ambiguous or smuggling-prone (R9). Exported for tests. */
export function headersSuspicious(raw: readonly string[]): boolean {
  let cl = 0;
  let te = 0;
  let host = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!;
    const val = raw[i + 1]!;
    if (!/^[A-Za-z0-9-]+$/.test(name) || BAD_CHARS.test(val) || val.includes('\0')) return true;
    const l = name.toLowerCase();
    if (l === 'content-length') {
      cl++;
      if (!/^\d{1,10}$/.test(val.trim())) return true;
    }
    if (l === 'transfer-encoding') te++;
    if (l === 'host') host++;
  }
  return cl > 1 || te > 1 || host > 1 || (cl > 0 && te > 0);
}

export function createJobProxy(opts: ProxyOptions): Promise<JobProxy> {
  const resolve = opts.resolve ?? defaultResolve;
  const connect = opts.connect ?? defaultConnect;
  const maxTunnels = opts.maxTunnels ?? 32;
  const idleMs = opts.idleMs ?? 30_000;
  const ov = opts.testOverrides;
  const stats: ProxyStats = {
    requests: 0,
    bytes: 0,
    blockedPrivate: 0,
    blockedPolicy: 0,
    overBytes: false,
    overRequests: false,
    resolves: new Map(),
    connects: 0,
  };
  const sockets = new Set<net.Socket>();
  let tunnels = 0;

  const blockedIp = (ip: string) => (ov?.allowAddress?.(ip) ? false : isBlockedIp(ip));
  const portOk = (p: number, def: number) => p === def || (ov?.allowPorts?.includes(p) ?? false);

  // R4: one lookup per host per job. The promise (including a rejection) is cached.
  const pins = new Map<string, Promise<Addr[]>>();
  function pin(host: string): Promise<Addr[]> {
    let p = pins.get(host);
    if (p) return p;
    p = (async () => {
      if (isIpLiteral(host)) {
        const address = host.replace(/^\[|\]$/g, '');
        if (blockedIp(address)) throw new ProxyBlocked();
        return [{ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }];
      }
      if (isBlockedHostname(host)) throw new ProxyBlocked();
      stats.resolves.set(host, (stats.resolves.get(host) ?? 0) + 1);
      const addrs = await resolve(host);
      if (addrs.length === 0) throw new Error('no addresses');
      // Mixed answers are rejected, not filtered.
      if (addrs.some((a) => blockedIp(a.address))) throw new ProxyBlocked();
      return addrs;
    })();
    pins.set(host, p);
    return p;
  }

  async function connectPinned(host: string, port: number): Promise<net.Socket> {
    const addrs = await pin(host);
    let last: unknown;
    for (let i = 0; i < addrs.length; i++) {
      stats.connects++;
      try {
        return await connect(addrs[i]!, port);
      } catch (e) {
        last = e;
        const code = (e as { code?: unknown } | null)?.code;
        if (!(typeof code === 'string' && FALLBACK.has(code))) break;
      }
    }
    throw last ?? new Error('connect failed');
  }

  function track(s: net.Socket) {
    sockets.add(s);
    s.on('error', () => s.destroy());
    s.once('close', () => sockets.delete(s));
    s.setTimeout(idleMs, () => s.destroy());
  }
  function count(n: number) {
    stats.bytes += n;
    if (stats.bytes > opts.maxBytes && !stats.overBytes) {
      stats.overBytes = true;
      for (const s of sockets) s.destroy();
    }
  }
  function admit(): boolean {
    stats.requests++;
    if (stats.requests > opts.maxRequests) {
      stats.overRequests = true;
      return false;
    }
    return !stats.overBytes;
  }
  function fail(e: unknown): 403 | 502 {
    if (e instanceof ProxyBlocked) {
      stats.blockedPrivate++;
      return 403;
    }
    return 502;
  }

  const server = http.createServer({
    insecureHTTPParser: false,
    maxHeaderSize: 8192,
    keepAliveTimeout: 1,
    headersTimeout: 10_000,
    requestTimeout: 30_000,
  });
  server.maxRequestsPerSocket = 1;
  server.on('connection', (s) => track(s));
  server.on('clientError', (_e, s) => {
    stats.blockedPolicy++;
    if (s.writable) s.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else s.destroy();
  });
  // Upgrade (WebSocket etc.) is never served.
  server.on('upgrade', (_req, s) => {
    stats.blockedPolicy++;
    s.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  const reply = (res: http.ServerResponse, code: number) => {
    // The marker lets render.ts tell a guard refusal from a page that answered 403 itself.
    res.writeHead(code, {
      connection: 'close',
      'content-length': 0,
      ...(code === 403 ? { 'x-cellar-proxy': 'blocked' } : {}),
    });
    res.end();
  };

  server.on('request', async (req, res) => {
    try {
      const conn = String(req.headers.connection ?? '').toLowerCase();
      if (
        req.headers.upgrade !== undefined ||
        conn.includes('upgrade') ||
        headersSuspicious(req.rawHeaders)
      ) {
        stats.blockedPolicy++;
        return reply(res, 400);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        stats.blockedPolicy++;
        return reply(res, 405);
      }
      if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) > 0) {
        stats.blockedPolicy++;
        return reply(res, 400);
      }
      // Absolute-URI only; origin-form is refused, and Host must agree with the request line.
      const target = req.url ?? '';
      let u: URL;
      if (!/^http:\/\//i.test(target) || BAD_CHARS.test(target)) {
        stats.blockedPolicy++;
        return reply(res, 400);
      }
      try {
        u = new URL(target);
      } catch {
        stats.blockedPolicy++;
        return reply(res, 400);
      }
      const hostHdr = req.headers.host;
      // Guard classification first for literals/names (no DNS), so a redirect to
      // 127.0.0.1:3000 reads as a guard refusal rather than a port error.
      const lit = u.hostname.replace(/\.$/, '');
      if ((isIpLiteral(lit) && blockedIp(lit.replace(/^\[|\]$/g, ''))) || isBlockedHostname(lit)) {
        stats.blockedPrivate++;
        return reply(res, 403);
      }
      if (
        u.username ||
        u.password ||
        !portOk(Number(u.port || 80), 80) ||
        (hostHdr !== undefined && hostHdr.toLowerCase() !== u.host.toLowerCase())
      ) {
        stats.blockedPolicy++;
        return reply(res, 400);
      }
      if (!admit()) return reply(res, 429);
      const host = u.hostname.replace(/\.$/, '');
      const port = Number(u.port || 80);

      const sock = await connectPinned(host, port);
      track(sock);
      const headers: Record<string, string> = {};
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]!.toLowerCase();
        if (!HOP.has(k)) headers[k] = req.rawHeaders[i + 1]!;
      }
      headers.host = u.host;
      headers.connection = 'close';
      // One pre-connected, pinned socket per request: no pooling across hosts.
      const agent = new (class extends http.Agent {
        override createConnection(): net.Socket {
          return sock;
        }
      })({ keepAlive: false });
      const up = http.request({
        agent,
        method: req.method,
        path: `${u.pathname}${u.search}`,
        headers,
      });
      res.on('close', () => up.destroy());
      up.on('error', () => {
        if (!res.headersSent) reply(res, 502);
        else res.destroy();
      });
      up.on('response', (ur) => {
        const out: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(ur.headers)) {
          if (v !== undefined && !HOP.has(k)) out[k] = v;
        }
        out.connection = 'close';
        res.writeHead(ur.statusCode ?? 502, out);
        ur.on('data', (c: Buffer) => count(c.length));
        ur.pipe(res);
      });
      up.end();
    } catch (e) {
      if (!res.headersSent) reply(res, fail(e));
      else res.destroy();
    }
  });

  server.on('connect', async (req, client: net.Socket, head: Buffer) => {
    const refuse = (code: number) => {
      client.end(`HTTP/1.1 ${code} X\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    try {
      const t = parseConnectTarget(req.url ?? '');
      if (
        !t ||
        head.length > 0 ||
        headersSuspicious(req.rawHeaders) ||
        !portOk(t.port, 443) ||
        tunnels >= maxTunnels
      ) {
        stats.blockedPolicy++;
        return refuse(400);
      }
      if (!admit()) return refuse(429);
      tunnels++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          tunnels--;
        }
      };
      client.once('close', release);
      let up: net.Socket;
      try {
        up = await connectPinned(t.host, t.port);
      } catch (e) {
        release();
        return refuse(fail(e));
      }
      track(up);
      up.once('close', () => client.destroy());
      client.once('close', () => up.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.on('data', (c: Buffer) => count(c.length));
      client.on('data', (c: Buffer) => count(c.length));
      up.pipe(client);
      client.pipe(up);
    } catch {
      client.destroy();
    }
  });

  return new Promise((resolveP, rejectP) => {
    server.once('error', rejectP);
    server.listen(0, '127.0.0.1', () => {
      resolveP({
        port: (server.address() as net.AddressInfo).port,
        stats,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
            server.closeAllConnections();
          }),
      });
    });
  });
}
