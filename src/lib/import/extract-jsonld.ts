import * as cheerio from 'cheerio';

// Pure: html string in, Recipe node out. No network, fs or db.

export type ExtractResult = {
  /** The chosen schema.org Recipe node, or null when the page has none. */
  node: Record<string, unknown> | null;
  /** How many Recipe nodes the page contained. */
  found: number;
  /** Human-readable notes for logs/warnings (never user text from the page). */
  notes: string[];
};

const MAX_SCRIPTS = 100;
const MAX_DEPTH = 12;
const MAX_NODES = 20_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `application/ld+json; charset=utf-8` in any case. */
const isLdJsonType = (t: string | undefined): boolean =>
  (t ?? '').split(';')[0]!.trim().toLowerCase() === 'application/ld+json';

/** Remove HTML-comment and CDATA wrappers that some CMSs put around the JSON. */
function unwrap(raw: string): string {
  let s = raw.replace(/^﻿/, '').trim();
  s = s.replace(/^<!--/, '').replace(/-->$/, '').trim();
  s = s
    .replace(/^\/\/\s*<!\[CDATA\[|^<!\[CDATA\[/, '')
    .replace(/(\/\/\s*)?\]\]>$/, '')
    .trim();
  return s;
}

/**
 * Safe repair for the two common defects: raw control characters inside strings
 * (escaped, or dropped when not whitespace) and trailing commas before } or ].
 * String-aware, so commas and brackets inside strings are never touched. It does not
 * evaluate or rewrite anything else, and the result is still parsed by JSON.parse.
 */
export function repairJson(s: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (c === '\\') {
        out += c + (s[i + 1] ?? '');
        i++;
      } else if (c === '"') {
        inStr = false;
        out += c;
      } else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c < ' ') continue;
      else out += c;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j]!)) j++;
      if (s[j] === '}' || s[j] === ']') continue; // trailing comma
      out += c;
    } else {
      out += c;
    }
  }
  return out;
}

function parseScript(raw: string): { value: unknown; repaired: boolean } | null {
  const text = unwrap(raw);
  if (!text) return null;
  try {
    return { value: JSON.parse(text), repaired: false };
  } catch {
    try {
      return { value: JSON.parse(repairJson(text)), repaired: true };
    } catch {
      return null;
    }
  }
}

function hasRecipeType(t: unknown): boolean {
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => {
    if (typeof x !== 'string') return false;
    // "Recipe", "schema:Recipe", "http(s)://schema.org/Recipe"
    return x.trim().split(/[/:#]/).pop() === 'Recipe';
  });
}

function ingredientCount(n: Obj): number {
  const v = n['recipeIngredient'] ?? n['ingredients'];
  return Array.isArray(v) ? v.length : typeof v === 'string' && v.trim() ? 1 : 0;
}

function collect(root: unknown, out: Obj[]): void {
  let visited = 0;
  const walk = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || ++visited > MAX_NODES) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    if (hasRecipeType(v['@type'])) out.push(v);
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
      if (key in v) walk(v[key], depth + 1);
    }
  };
  walk(root, 0);
}

const MAX_TAG_LEN = 2000;

/**
 * Linear scan for `<script type="application/ld+json">` blocks. A full DOM parse of
 * untrusted 5 MB input is quadratic on deeply nested markup (measured: 200k nested
 * `<div>` takes 4 s in parse5 plus 14 s for the selector), so the page is never parsed as
 * a tree. Cheerio only parses each short `<script ...>` open tag, to read its attributes
 * with real HTML quoting rules.
 */
function* ldJsonScripts(html: string): Generator<string> {
  const lower = html.toLowerCase();
  let pos = 0;
  let count = 0;
  while (count <= MAX_SCRIPTS) {
    const open = lower.indexOf('<script', pos);
    if (open === -1) return;
    const after = lower[open + 7];
    if (after !== undefined && !/[\s>/]/.test(after)) {
      pos = open + 7;
      continue;
    }
    // End of the open tag: first '>' outside quotes.
    let end = -1;
    let quote = '';
    const limit = Math.min(html.length, open + MAX_TAG_LEN);
    for (let i = open + 7; i < limit; i++) {
      const c = html[i]!;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') {
        end = i;
        break;
      }
    }
    if (end === -1) {
      pos = limit; // over-long or unterminated tag: skip it whole, keeps the scan linear
      continue;
    }
    const closeAt = lower.indexOf('</script', end + 1);
    const bodyEnd = closeAt === -1 ? html.length : closeAt;
    pos = closeAt === -1 ? html.length : closeAt + 8;
    const openTag = html.slice(open, end + 1);
    if (!lower.slice(open, end + 1).includes('ld+json')) continue;
    const type = cheerio.load(`${openTag}</script>`)('script').attr('type');
    if (!isLdJsonType(type)) continue;
    count++;
    if (count > MAX_SCRIPTS) {
      yield '\u0000too_many';
      return;
    }
    yield html.slice(end + 1, bodyEnd);
  }
}

export function extractRecipeNode(html: string): ExtractResult {
  const notes: string[] = [];
  const recipes: Obj[] = [];
  let scripts = 0;

  for (const body of ldJsonScripts(html)) {
    if (body === '\u0000too_many') {
      notes.push('too_many_scripts');
      break;
    }
    scripts++;
    const parsed = parseScript(body);
    if (!parsed) {
      notes.push('invalid_jsonld_skipped');
      continue;
    }
    if (parsed.repaired) notes.push('jsonld_repaired');
    collect(parsed.value, recipes);
  }
  if (scripts === 0) notes.push('no_jsonld');

  if (recipes.length === 0) return { node: null, found: 0, notes };
  if (recipes.length > 1) notes.push('multiple_recipes');
  let best = recipes[0]!;
  for (const r of recipes) if (ingredientCount(r) > ingredientCount(best)) best = r; // ties keep the first
  return { node: best, found: recipes.length, notes };
}
