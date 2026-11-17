import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Docs drift guard: every variable that src/lib/env.ts reads must be documented in the README
 * "Configuration" table and listed in .env.example. The names are parsed from the source text
 * (an upper-case key at the start of a line followed by a colon, which is how both the zod
 * schema and the rateLimitShape() helper declare them), so a new variable cannot be added
 * without this test noticing. No imports from src/, so it stays fast and dependency-free.
 */

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** Names that are not inputs an operator sets. One comment each. */
const NOT_OPERATOR_INPUTS = new Set([
  // Derived output of the env parser (the legacy raw-HTML location), never read from the environment.
  'LEGACY_RAW_HTML_DIR',
]);

function envNames(): string[] {
  const names = new Set<string>();
  for (const m of read('src/lib/env.ts').matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)) names.add(m[1]);
  return [...names].filter((n) => !NOT_OPERATOR_INPUTS.has(n)).sort();
}

describe('environment variable documentation', () => {
  const names = envNames();
  const readme = read('README.md');
  const example = read('.env.example');

  it('finds the variables in env.ts (guards the parser itself)', () => {
    expect(names.length).toBeGreaterThanOrEqual(30);
    for (const known of [
      'SESSION_SECRET',
      'RESTORE_BODY_MAX',
      'RATE_LIMIT_PUBLIC_MAX',
      'LOG_LEVEL',
    ])
      expect(names).toContain(known);
  });

  it('lists every variable as a row of the README table', () => {
    const missing = names.filter((n) => !readme.includes(`| \`${n}\``));
    expect(missing, `missing from the README Configuration table: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('mentions every variable in .env.example (commented-out lines count)', () => {
    const missing = names.filter((n) => !new RegExp(`^#?\\s*${n}=`, 'm').test(example));
    expect(missing, `missing from .env.example: ${missing.join(', ')}`).toEqual([]);
  });
});
