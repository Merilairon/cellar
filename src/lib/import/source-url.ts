/**
 * Two forms of a recipe URL (data-model G12, owner decision Q3):
 *
 * - `normalizeSourceUrl` is the comparison key for duplicate detection: http and https are
 *   equal (the key is always https), host lowercased (kept `www.`), fragment, default port
 *   and tracking parameters removed, remaining query parameters sorted, trailing slash
 *   removed.
 * - `storedSourceUrl` is what is stored and linked: the same canonical form but with the
 *   scheme the user entered, so an http-only site keeps a working link.
 *
 * Both return null for anything that is not a plain http(s) URL without credentials.
 */

type Canonical = { scheme: 'http' | 'https'; host: string; port: string; rest: string };

function canonical(raw: unknown): Canonical | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  u.hash = '';
  const keep = [...u.searchParams.entries()].filter(
    ([k]) => !/^utm_/i.test(k) && !['fbclid', 'gclid'].includes(k.toLowerCase()),
  );
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = new URLSearchParams(keep).toString();
  const path = u.pathname.replace(/\/+$/, '');
  return {
    scheme: u.protocol === 'http:' ? 'http' : 'https',
    host: u.hostname,
    // The URL parser already drops the default port of the entered scheme.
    port: u.port,
    rest: `${path}${search ? `?${search}` : ''}`,
  };
}

/** Comparison key for duplicate detection (always https). */
export function normalizeSourceUrl(raw: unknown): string | null {
  const c = canonical(raw);
  if (!c) return null;
  const host = c.port && c.port !== '80' && c.port !== '443' ? `${c.host}:${c.port}` : c.host;
  return `https://${host}${c.rest}`;
}

/** The URL to store: canonical, with the scheme the user entered. */
export function storedSourceUrl(raw: unknown): string | null {
  const c = canonical(raw);
  if (!c) return null;
  return `${c.scheme}://${c.host}${c.port ? `:${c.port}` : ''}${c.rest}`;
}

/**
 * Every stored form (`storedSourceUrl` output) that shares the comparison key of `raw`, for
 * the duplicate lookup. The key drops 80 and 443 for either scheme, but a stored URL keeps
 * the port that is not the default of the scheme the user entered (`http://h:443/x`,
 * `https://h:80/x`), so those spellings are candidates too. Derived from the same
 * `canonical()` as the other two functions so they cannot disagree. [] for invalid input.
 */
export function sourceUrlCandidates(raw: unknown): string[] {
  const c = canonical(raw);
  if (!c) return [];
  const ports =
    c.port === '' || c.port === '80' || c.port === '443'
      ? [
          { scheme: 'https', port: '' },
          { scheme: 'http', port: '' },
          { scheme: 'https', port: '80' },
          { scheme: 'http', port: '443' },
        ]
      : [
          { scheme: 'https', port: c.port },
          { scheme: 'http', port: c.port },
        ];
  return ports.map((p) => `${p.scheme}://${c.host}${p.port ? `:${p.port}` : ''}${c.rest}`);
}
