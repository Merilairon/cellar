import * as cheerio from 'cheerio';
import type { ExtractResult } from './extract-jsonld';

// Pure: html string in, Recipe-node-shaped object out (what normalizeRecipe accepts). No
// network, fs or db. Fallback for pages with `itemscope`/`itemprop` markup and no JSON-LD.
//
// Bounds (same style as extract-jsonld.ts): the page is parsed with htmlparser2 (linear on
// hostile nesting, unlike a spec-compliant tree builder), then walked by hand with a hard
// element budget and a depth cap. There is no selector engine and no regex over the document;
// the only whole-document scan is a literal `includes`. `<script>`, `<style>` and comments
// are never read, nested scopes of other types are not merged into the recipe.

const MAX_TAGS = 40_000; // '<' characters parsed; measured: parser time is superlinear in nesting (100k nested divs = 3 s, 350k = 42 s)
const MAX_NODES = 20_000; // elements visited per document, across all passes
const MAX_DEPTH = 64;
const MAX_SCOPES = 20; // Recipe scopes considered
const MAX_ITEMS = 500; // ingredients, and steps
const MAX_TEXT = 8_000; // characters of one property value
const MAX_ATTR = 4_000;
const MAX_STEP_DEPTH = 4;

type El = {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: El[];
  data?: string;
};
type Obj = Record<string, unknown>;

class Budget {
  used = 0;
  take(): boolean {
    return ++this.used <= MAX_NODES;
  }
}

const isEl = (n: El): boolean => n.type === 'tag' || n.type === 'style' || n.type === 'script';
const SKIP = new Set(['script', 'style', 'template', 'noscript']);
const attr = (e: El, k: string): string | undefined => {
  const v = e.attribs?.[k];
  return typeof v === 'string' ? v.slice(0, MAX_ATTR) : undefined;
};
const kids = (e: El): El[] => (e.children ?? []).filter((c) => isEl(c) && !SKIP.has(c.name ?? ''));

/** Last path segment of an itemtype token when it is a schema.org type, lowercase-insensitive host. */
function schemaTypes(e: El): string[] {
  const raw = attr(e, 'itemtype');
  if (!raw) return [];
  const out: string[] = [];
  for (const tok of raw.split(' ').slice(0, 8)) {
    let t = tok.trim().toLowerCase();
    if (t.startsWith('https://')) t = t.slice(8);
    else if (t.startsWith('http://')) t = t.slice(7);
    else continue;
    if (t.startsWith('www.')) t = t.slice(4);
    if (!t.startsWith('schema.org/')) continue;
    t = t.slice(11);
    if (t.endsWith('/')) t = t.slice(0, -1);
    if (t && !t.includes('/')) out.push(t);
  }
  return out;
}
const isScope = (e: El): boolean => attr(e, 'itemscope') !== undefined;
const propNames = (e: El): string[] =>
  (attr(e, 'itemprop') ?? '').split(' ').filter(Boolean).slice(0, 8);

const collapse = (s: string): string => s.split(/\s+/).filter(Boolean).join(' ');

/** Visible text of an element, bounded in characters and nodes. */
function textOf(root: El, budget: Budget): string {
  let out = '';
  const walk = (e: El, depth: number): void => {
    if (out.length >= MAX_TEXT || depth > MAX_DEPTH) return;
    for (const c of e.children ?? []) {
      if (out.length >= MAX_TEXT) return;
      if (c.type === 'text') out += (c.data ?? '').slice(0, MAX_TEXT) + ' ';
      else if (isEl(c) && !SKIP.has(c.name ?? '')) {
        if (!budget.take()) return;
        if (c.name === 'br') out += '\n';
        else walk(c, depth + 1);
      }
    }
  };
  walk(root, 0);
  return collapse(out.slice(0, MAX_TEXT * 2)).slice(0, MAX_TEXT);
}

/** Microdata value of a property element (spec "property values"), plus `content` tolerance. */
function valueOf(e: El, budget: Budget): string {
  const n = e.name ?? '';
  if (n === 'meta') return attr(e, 'content') ?? '';
  if (['img', 'audio', 'video', 'source', 'embed', 'iframe', 'track'].includes(n))
    return attr(e, 'src') ?? attr(e, 'content') ?? '';
  if (['a', 'area', 'link'].includes(n)) return attr(e, 'href') ?? attr(e, 'content') ?? '';
  if (n === 'time') return attr(e, 'datetime') ?? attr(e, 'content') ?? textOf(e, budget);
  if (n === 'data' || n === 'meter')
    return attr(e, 'value') ?? attr(e, 'content') ?? textOf(e, budget);
  const c = attr(e, 'content');
  if (c !== undefined) return c;
  return textOf(e, budget);
}

type Props = Map<string, El[]>;

/**
 * Properties of a scope: itemprop elements below it, not looking inside nested scopes or
 * inside another property's value (except plain wrappers without itemprop).
 */
function propsOf(scope: El, budget: Budget): Props {
  const props: Props = new Map();
  const walk = (e: El, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (const c of kids(e)) {
      if (!budget.take()) return;
      const names = propNames(c);
      for (const nm of names) {
        const l = props.get(nm) ?? [];
        if (l.length < MAX_ITEMS) l.push(c);
        props.set(nm, l);
      }
      if (names.length === 0 && !isScope(c)) walk(c, depth + 1);
    }
  };
  walk(scope, 0);
  return props;
}

const first = (p: Props, ...names: string[]): El | undefined => {
  for (const n of names) {
    const l = p.get(n);
    if (l && l.length) return l[0];
  }
  return undefined;
};

function stepText(e: El, budget: Budget): string {
  if (isScope(e)) {
    const p = propsOf(e, budget);
    const t = first(p, 'text', 'description', 'name');
    if (t) return valueOf(t, budget);
  }
  return valueOf(e, budget);
}

type Step = { '@type': 'HowToStep'; text: string };
type Section = { '@type': 'HowToSection'; name: string; itemListElement: Step[] };

function stepsFrom(e: El, budget: Budget, depth: number, out: Array<Step | Section>): void {
  if (out.length >= MAX_ITEMS || depth > MAX_STEP_DEPTH) return;
  if (isScope(e)) {
    const types = schemaTypes(e);
    if (types.includes('howtosection')) {
      const p = propsOf(e, budget);
      const nameEl = first(p, 'name');
      const items: Step[] = [];
      for (const it of p.get('itemListElement') ?? []) {
        const t = stepText(it, budget);
        if (t && items.length < MAX_ITEMS) items.push({ '@type': 'HowToStep', text: t });
      }
      if (items.length)
        out.push({
          '@type': 'HowToSection',
          name: nameEl ? valueOf(nameEl, budget).slice(0, 80) : '',
          itemListElement: items,
        });
      return;
    }
    const t = stepText(e, budget);
    if (t) out.push({ '@type': 'HowToStep', text: t });
    return;
  }
  // Plain container: scoped steps or li/p children are the steps; else its own text lines.
  const parts = kids(e).filter(
    (c) => budget.take() && (isScope(c) || c.name === 'li' || c.name === 'p'),
  );
  if (parts.length) {
    for (const c of parts) stepsFrom(c, budget, depth + 1, out);
    return;
  }
  const inner = kids(e).filter((c) => c.name === 'ol' || c.name === 'ul' || c.name === 'div');
  if (inner.length && !textOfDirect(e)) {
    for (const c of inner) stepsFrom(c, budget, depth + 1, out);
    return;
  }
  const t = valueOf(e, budget);
  if (t) out.push({ '@type': 'HowToStep', text: t });
}

const textOfDirect = (e: El): string =>
  (e.children ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.data ?? '')
    .join('')
    .trim();

function buildRecipe(scope: El, budget: Budget): Obj {
  const p = propsOf(scope, budget);
  const text = (...names: string[]): string | undefined => {
    const e = first(p, ...names);
    const v = e ? valueOf(e, budget).trim() : '';
    return v || undefined;
  };
  const list = (...names: string[]): string[] => {
    const out: string[] = [];
    for (const n of names)
      for (const e of p.get(n) ?? []) {
        const v = valueOf(e, budget).trim();
        if (v && out.length < MAX_ITEMS) out.push(v);
      }
    return out;
  };
  const steps: Array<Step | Section> = [];
  for (const e of p.get('recipeInstructions') ?? []) stepsFrom(e, budget, 0, steps);

  const node: Obj = { '@type': 'Recipe' };
  const set = (k: string, v: unknown): void => {
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) node[k] = v;
  };
  set('name', text('name'));
  set('description', text('description'));
  set('recipeIngredient', list('recipeIngredient', 'ingredients'));
  set('recipeInstructions', steps);
  set('image', text('image'));
  set('recipeYield', text('recipeYield'));
  for (const k of ['prepTime', 'cookTime', 'totalTime']) set(k, text(k));
  set('recipeCategory', list('recipeCategory'));
  set('keywords', text('keywords'));
  const a = first(p, 'author');
  if (a) {
    if (isScope(a)) {
      const nm = first(propsOf(a, budget), 'name');
      if (nm) set('author', { '@type': 'Person', name: valueOf(nm, budget) });
    } else set('author', valueOf(a, budget) || undefined);
  }
  return node;
}

const ingredientCount = (n: Obj): number =>
  Array.isArray(n['recipeIngredient']) ? (n['recipeIngredient'] as unknown[]).length : 0;

/** Cut the document after the MAX_TAGS-th '<' so hostile nesting cannot blow up the parse. */
function clip(html: string): string {
  let pos = 0;
  for (let n = 0; n < MAX_TAGS; n++) {
    const i = html.indexOf('<', pos);
    if (i === -1) return html;
    pos = i + 1;
  }
  return html.slice(0, pos);
}

export function extractMicrodataRecipe(html: string): ExtractResult {
  const notes: string[] = [];
  // Literal scan only: skip the parse for the vast majority of pages.
  if (!html.toLowerCase().includes('itemscope')) return { node: null, found: 0, notes };
  let roots: El[];
  try {
    roots = cheerio
      .load(clip(html), { xml: { xmlMode: false, decodeEntities: true } })
      .root()
      .toArray() as unknown as El[];
  } catch {
    return { node: null, found: 0, notes: ['microdata_parse_failed'] };
  }
  const budget = new Budget();
  const scopes: El[] = [];
  const find = (e: El, depth: number): void => {
    if (depth > MAX_DEPTH || scopes.length >= MAX_SCOPES) return;
    for (const c of kids(e)) {
      if (!budget.take()) return;
      if (isScope(c) && schemaTypes(c).includes('recipe')) {
        scopes.push(c); // a nested Recipe inside a Recipe is not a second recipe
        if (scopes.length >= MAX_SCOPES) return;
        continue;
      }
      find(c, depth + 1);
    }
  };
  for (const r of roots) find(r, 0);
  if (budget.used > MAX_NODES) notes.push('microdata_node_cap');
  if (scopes.length === 0) return { node: null, found: 0, notes };

  const recipes = scopes.map((s) => buildRecipe(s, budget));
  if (recipes.length > 1) notes.push('multiple_recipes');
  let best = recipes[0]!;
  for (const r of recipes) if (ingredientCount(r) > ingredientCount(best)) best = r;
  notes.push('microdata');
  return { node: best, found: recipes.length, notes };
}
