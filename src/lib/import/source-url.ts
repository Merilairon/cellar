/**
 * Canonical form of a recipe URL for duplicate detection and for the stored `source_url`
 * (data-model G12): http and https are treated as equal (stored as https), host lowercased
 * (kept `www.`), fragment, default port and tracking parameters removed, remaining query
 * parameters sorted, trailing slash removed. Returns null for anything that is not a plain
 * http(s) URL without credentials.
 */
export function normalizeSourceUrl(raw: unknown): string | null {
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
  const host =
    u.port && u.port !== '80' && u.port !== '443' ? `${u.hostname}:${u.port}` : u.hostname;
  return `https://${host}${path}${search ? `?${search}` : ''}`;
}
