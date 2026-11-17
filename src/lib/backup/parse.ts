// JSON entry point for untrusted backup text (R12). Pure: no fs, network or db.
// Rejects prototype-polluting keys at any depth and bounds nesting before and after parsing.

export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
export const MAX_JSON_DEPTH = 32;

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'backup_invalid'; reason: 'syntax' | 'too_deep' | 'forbidden_key' };

/** Max bracket depth of JSON text, ignoring brackets inside strings. O(n), no recursion. */
function textDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inStr) {
      if (c === 0x5c)
        i++; // backslash: skip the escaped char
      else if (c === 0x22) inStr = false;
    } else if (c === 0x22) inStr = true;
    else if (c === 0x7b || c === 0x5b) {
      if (++depth > max) max = depth;
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  return max;
}

/**
 * Walk an already-parsed value (iteratively) and report the first problem: a forbidden own
 * key at any depth (including `__proto__` created by JSON.parse), or nesting beyond the cap.
 */
export function findUnsafeStructure(value: unknown): 'forbidden_key' | 'too_deep' | null {
  const stack: Array<{ v: unknown; d: number }> = [{ v: value, d: 0 }];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const { v, d } = stack.pop()!;
    if (typeof v !== 'object' || v === null) continue;
    if (d > MAX_JSON_DEPTH) return 'too_deep';
    if (seen.has(v)) continue; // JSON cannot be cyclic; this guards callers passing live objects
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) stack.push({ v: item, d: d + 1 });
      continue;
    }
    for (const key of Object.getOwnPropertyNames(v)) {
      if (FORBIDDEN_KEYS.has(key)) return 'forbidden_key';
      stack.push({ v: (v as Record<string, unknown>)[key], d: d + 1 });
    }
  }
  return null;
}

/** Parse backup JSON text. Never throws. */
export function parseBackupJson(text: string): ParseResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (textDepth(src) > MAX_JSON_DEPTH)
    return { ok: false, code: 'backup_invalid', reason: 'too_deep' };
  let value: unknown;
  try {
    value = JSON.parse(src, (key, v: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('forbidden_key');
      return v;
    });
  } catch (e) {
    const reason = e instanceof Error && e.message === 'forbidden_key' ? 'forbidden_key' : 'syntax';
    return { ok: false, code: 'backup_invalid', reason };
  }
  const unsafe = findUnsafeStructure(value);
  if (unsafe) return { ok: false, code: 'backup_invalid', reason: unsafe };
  return { ok: true, value };
}
