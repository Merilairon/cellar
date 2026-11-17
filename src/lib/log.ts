/**
 * Structured logs without a dependency (G18): one JSON object per line.
 * debug/info go to stdout, warn/error to stderr. Never throws.
 *
 * Reads `process.env.LOG_LEVEL` directly (validated at boot in `env.ts`) so this module stays
 * import-safe everywhere, including scripts and code that must not fail on a bad env.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * Keys whose values are never written. Matched on the key lowercased with `-`, `_`, `.` and
 * spaces removed: exact names for the generic words, substrings for credential-like names, so
 * `Set-Cookie`, `x-api-key`, `refresh_token`, `userEmail` are covered too.
 */
const EXACT_KEYS = new Set(['body', 'note', 'notes', 'raw', 'html', 'ip', 'url', 'ua']);
const KEY_PARTS =
  /token|secret|passw|cookie|authori[sz]|session|credential|apikey|csrf|jwt|bearer|email|shareurl|forwardedfor/;

const isRedactedKey = (key: string): boolean => {
  const k = key.toLowerCase().replace(/[-_. ]/g, '');
  return EXACT_KEYS.has(k) || KEY_PARTS.test(k);
};

const MAX_STRING = 500;
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;
const REDACTED = '[redacted]';

/**
 * Secrets that can sit inside a string value (an error message): share URLs, URL query and
 * credentials, absolute file paths.
 */
function scrub(v: string): string {
  return v
    .replace(/\/r\/[A-Za-z0-9_-]{16,}/g, '/r/[redacted]')
    .replace(/\b(https?:\/\/)[^\s/?#]*@/gi, '$1[redacted]@')
    .replace(/(https?:\/\/[^\s?#]*)\?[^\s#]*/gi, '$1?[redacted]')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@%+~ -]+){2,}/g, '[path]');
}

function threshold(): number {
  const v = process.env.LOG_LEVEL;
  return v && Object.hasOwn(RANK, v) ? RANK[v as LogLevel] : RANK.info;
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>, debug: boolean): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case 'string':
      return scrub(
        value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[truncated]` : value,
      );
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return `[${typeof value}]`;
  }
  const obj = value as object;
  if (seen.has(obj)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[max-depth]';
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    return `[bytes:${(obj as ArrayBufferView).byteLength}]`;
  }
  if (obj instanceof Map || obj instanceof Set) return `[${obj.constructor.name}(${obj.size})]`;
  seen.add(obj);
  try {
    if (obj instanceof Error) {
      const out: Record<string, unknown> = { name: obj.name };
      const code = (obj as NodeJS.ErrnoException).code;
      if (typeof code === 'string') out.code = code;
      out.message = sanitize(obj.message, depth + 1, seen, debug);
      if (debug && obj.stack) out.stack = sanitize(obj.stack, depth + 1, seen, debug);
      return out;
    }
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
    if (Array.isArray(obj)) {
      const items = obj.slice(0, MAX_ITEMS).map((v) => sanitize(v, depth + 1, seen, debug));
      if (obj.length > MAX_ITEMS) items.push(`[+${obj.length - MAX_ITEMS} more]`);
      return items;
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const key of keys.slice(0, MAX_ITEMS)) {
      if (isRedactedKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      try {
        out[key] = sanitize((obj as Record<string, unknown>)[key], depth + 1, seen, debug);
      } catch {
        out[key] = '[unserializable]'; // a throwing getter loses only its own field
      }
    }
    if (keys.length > MAX_ITEMS) out['[more]'] = keys.length - MAX_ITEMS;
    return out;
  } finally {
    seen.delete(obj); // only ancestors count as circular; siblings may share a reference
  }
}

for (const stream of [process.stdout, process.stderr]) {
  // An async EPIPE (closed pipe) must not become an uncaught exception.
  stream?.on?.('error', () => undefined);
}

export function log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  try {
    if (RANK[level] === undefined || RANK[level] < threshold()) return;
    const debug = process.env.LOG_LEVEL === 'debug';
    const safe = sanitize(fields ?? {}, 0, new WeakSet(), debug) as Record<string, unknown>;
    // Reserved keys win over caller fields of the same name.
    const line = JSON.stringify({ ...safe, ts: new Date().toISOString(), level, event });
    (RANK[level] >= RANK.warn ? process.stderr : process.stdout).write(line + '\n');
  } catch {
    // Logging must never break a request.
  }
}

/**
 * A short, content-free code for an error: errno code (`ENOENT`) or the error class name.
 * Use where the message could carry file names or user content (restore).
 */
export function errCode(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as NodeJS.ErrnoException).code;
    return typeof code === 'string' ? code : e.name;
  }
  return 'non_error';
}
