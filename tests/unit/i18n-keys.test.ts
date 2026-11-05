import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';

const root = join(__dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const files = walk(join(root, 'src')).filter((f) => !f.includes(`${join('src', 'i18n')}`));

function flatten(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

const catalogKeys = new Set(flatten(en));
const namespaces = new Set(Object.keys(en));

describe('message catalog', () => {
  it('every key used in code exists in messages/en.json', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // t('a.b') calls and any dotted string literal rooted in a catalog namespace
      const literal = /(['"`])([A-Za-z]+(?:\.[A-Za-z0-9_]+)+)\1/g;
      for (const m of src.matchAll(literal)) {
        const key = m[2];
        if (namespaces.has(key.split('.')[0]) && !catalogKeys.has(key)) {
          missing.push(`${relative(root, f)}: ${key}`);
        }
      }
      for (const m of src.matchAll(/\bt\(\s*(['"`])([^'"`]+)\1/g)) {
        if (!catalogKeys.has(m[2])) missing.push(`${relative(root, f)}: ${m[2]}`);
      }
      expect(src).not.toMatch(/\bt\(\s*`[^`]*\$\{/); // dynamic keys cannot be checked
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('has no literal text in JSX', () => {
    const offenders: string[] = [];
    for (const f of files.filter((p) => p.endsWith('.tsx') && !p.endsWith('layout.tsx'))) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const textLine =
          /^\s*([A-Z][A-Za-z ,.!?'-]*|[a-z]+ [A-Za-z ,.!?'-]*[^,\s])$/.test(line) &&
          !/^\s*(import|export|return|const|let|type|if|else|async|function)\b/.test(line);
        const inline = />\s*[A-Za-z][^<>{}=;]*<\//.test(line);
        if (textLine || inline) offenders.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
