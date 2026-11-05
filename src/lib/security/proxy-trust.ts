import { BlockList, isIP } from 'node:net';

/**
 * Trusted-proxy resolution for X-Forwarded-For / X-Forwarded-Proto.
 *
 * SPIKE RESULT (Next 16.4.5): the TCP peer address is NOT exposed to route handlers or server
 * actions (no `request.ip`, the Node socket is not reachable from the Web `Request`). Worse,
 * base-server.js does `req.headers['x-forwarded-for'] ??= socket.remoteAddress`, so the header
 * is the peer only when the client sent none; a client-supplied value is indistinguishable.
 * A custom server.ts is not wanted, so we cannot check "direct peer in TRUSTED_PROXIES".
 *
 * FALLBACK (documented in docs/tasks/v0.1-architecture.md):
 * - `TRUSTED_PROXIES` empty (default): forwarded headers are ignored entirely; there is no
 *   usable per-client address, so callers fall back to one shared bucket (fail closed).
 * - `TRUSTED_PROXIES` set: the operator asserts that every request reaches the app through a
 *   listed proxy (the app port is NOT published, e.g. the Caddy compose profile). The client
 *   is the right-most X-Forwarded-For hop that is not itself a trusted proxy; entries to the
 *   left of it are client-controlled and never used.
 * - If a real peer address is ever available (`peer` argument), headers are honored only when
 *   the peer matches, which is the strict behavior.
 */

export type TrustMatcher = (ip: string) => boolean;

/** Strip brackets/port-less zone, lower-case, unwrap IPv4-mapped IPv6. Returns null if not an IP. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim().toLowerCase();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped) v = mapped[1];
  return isIP(v) ? v : null;
}

function parseEntry(
  entry: string,
): { addr: string; prefix?: number; family: 'ipv4' | 'ipv6' } | null {
  const [addrPart, prefixPart, extra] = entry.split('/');
  if (extra !== undefined) return null;
  const addr = normalizeIp(addrPart);
  if (!addr) return null;
  const family = isIP(addr) === 4 ? 'ipv4' : 'ipv6';
  if (prefixPart === undefined) return { addr, family };
  if (!/^\d{1,3}$/.test(prefixPart)) return null;
  const prefix = Number(prefixPart);
  if (prefix > (family === 'ipv4' ? 32 : 128)) return null;
  return { addr, prefix, family };
}

/** True for a bare IP or CIDR. Used by env validation. */
export function isValidProxyEntry(entry: string): boolean {
  return parseEntry(entry) !== null;
}

/** Throws on an invalid entry. An empty list trusts nothing. */
export function createTrustMatcher(entries: readonly string[]): TrustMatcher {
  const list = new BlockList();
  for (const entry of entries) {
    const p = parseEntry(entry);
    if (!p) throw new Error(`Invalid TRUSTED_PROXIES entry: ${entry}`);
    if (p.prefix === undefined) list.addAddress(p.addr, p.family);
    else list.addSubnet(p.addr, p.prefix, p.family);
  }
  return (ip) => {
    const n = normalizeIp(ip);
    return n !== null && list.check(n, isIP(n) === 4 ? 'ipv4' : 'ipv6');
  };
}

export interface ForwardedInput {
  forwardedFor?: string | null;
  forwardedProto?: string | null;
  /** Real TCP peer, when the runtime can supply it. Not available in Next 16 handlers. */
  peer?: string | null;
}

export interface ResolvedClient {
  /** Client address, or null when none can be trusted. */
  ip: string | null;
  proto: 'http' | 'https' | null;
  /** True if forwarded headers were honored. */
  trusted: boolean;
}

export function resolveClient(
  input: ForwardedInput,
  entries: readonly string[],
  matcher: TrustMatcher = createTrustMatcher(entries),
): ResolvedClient {
  const peer = normalizeIp(input.peer);
  if (entries.length === 0) return { ip: peer, proto: null, trusted: false };
  if (input.peer !== undefined && input.peer !== null && !(peer && matcher(peer))) {
    return { ip: peer, proto: null, trusted: false };
  }
  let ip: string | null = null;
  const hops = (input.forwardedFor ?? '').split(',').map((h) => h.trim());
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = normalizeIp(hops[i]);
    if (!hop) break; // garbage: stop, never skip over it to a client-controlled hop further left
    if (matcher(hop)) continue; // a trusted proxy; keep walking left
    ip = hop;
    break;
  }
  // Right-most entry of the proto chain is the one our proxy appended.
  const protoHop = (input.forwardedProto ?? '').split(',').pop()?.trim().toLowerCase();
  const proto = protoHop === 'https' || protoHop === 'http' ? protoHop : null;
  return { ip: ip ?? peer, proto, trusted: true };
}
