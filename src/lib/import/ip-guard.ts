// Pure, no network. Decides whether an IP literal may be contacted by the importer.
// Fail closed: anything that does not parse as a plain IPv4/IPv6 literal is blocked.

function parseV4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

/** Parse an IPv6 literal (no brackets, no zone id) to 16 bytes. */
function parseV6(input: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(input) || !input.includes(':')) return null;
  let s = input;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    const v4 = parseV4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    s = s.slice(0, lastColon + 1) + '0:0'; // placeholder groups, replaced below
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !rest) return null;
  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<number>(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length) {
    groups[6] = (tail[0]! << 8) | tail[1]!;
    groups[7] = (tail[2]! << 8) | tail[3]!;
  }
  return groups.flatMap((g) => [g >> 8, g & 0xff]);
}

function blockedV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0/24, 192.0.2/24 (TEST-NET-1)
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast (deprecated)
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224 // multicast, reserved, broadcast
  );
}

function blockedV6(x: number[]): boolean {
  const zero = (from: number, to: number) => x.slice(from, to).every((v) => v === 0);
  const v4 = (at: number) => blockedV4(x.slice(at, at + 4));
  if (zero(0, 15) && (x[15] === 0 || x[15] === 1)) return true; // :: and ::1
  if (zero(0, 12)) return true; // IPv4-compatible ::a.b.c.d (deprecated), never legitimate
  if (zero(0, 10) && x[10] === 0xff && x[11] === 0xff) return v4(12); // ::ffff:a.b.c.d
  if (x[0] === 0 && x[1] === 0x64 && x[2] === 0xff && x[3] === 0x9b && zero(4, 12)) return v4(12); // NAT64
  if (zero(0, 8) && x[8] === 0xff && x[9] === 0xff && zero(10, 12)) return v4(12); // ::ffff:0:a.b.c.d (SIIT)
  if (x[0] === 0 && x[1] === 0x64 && x[2] === 0xff && x[3] === 0x9b && x[4] === 0 && x[5] === 1)
    return true; // 64:ff9b:1::/48 local-use NAT64
  if ((x[0]! & 0xfe) === 0xfc) return true; // fc00::/7
  if (x[0] === 0xfe && (x[1]! & 0xc0) >= 0x80) return true; // fe80::/10 and fec0::/10
  if (x[0] === 0xff) return true; // multicast
  if (x[0] === 0x20 && x[1] === 0x01 && x[2] === 0x0d && x[3] === 0xb8) return true; // 2001:db8::/32
  if (x[0] === 0x20 && x[1] === 0x01 && x[2] === 0 && x[3] === 0) return true; // Teredo
  if (x[0] === 0x20 && x[1] === 0x02) return v4(2); // 6to4 embeds an IPv4
  if (x[0] === 0x01 && x[1] === 0 && zero(2, 8)) return true; // 100::/64 discard
  return false;
}

/** True when the literal must not be contacted (or is not a valid IP literal at all). */
export function isBlockedIp(ip: string): boolean {
  const lit = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const v4 = parseV4(lit);
  if (v4) return blockedV4(v4);
  const v6 = parseV6(lit);
  if (v6) return blockedV6(v6);
  return true;
}

export function isIpLiteral(s: string): boolean {
  const lit = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  return parseV4(lit) !== null || parseV6(lit) !== null;
}

/** Hostnames that are blocked by name regardless of what they resolve to. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === 'metadata.google.internal' ||
    h.endsWith('.internal') ||
    h.endsWith('.local')
  );
}
