// Registry of every regular expression used by the mapper modules (tasklist T9). Each
// pattern is a constant, never built from input, and is run against adversarial strings
// by map-bounds.test.ts. Prefer scanners and Set/Map lookups; register here only what
// remains.

export const MAPPER_PATTERNS: Array<{ name: string; re: RegExp }> = [];

/** Register and return a constant pattern. */
export function pattern(name: string, re: RegExp): RegExp {
  MAPPER_PATTERNS.push({ name, re });
  return re;
}
