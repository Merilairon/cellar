import { recipeInputSchema, type RecipeInput } from '@/lib/recipes/schemas';
import { isoDurationToMinutes } from './duration';
import { parseIngredientLine, toIngredientFields } from './ingredient-parser';
import { sanitizeText, sanitizeUrl } from './sanitize';

// Pure: schema.org Recipe node in, draft out. 3a maps every recipe to list view with one
// section; the auto-mapper (3b) re-maps from the stored draft.

export type Draft = RecipeInput & {
  /** keywords + recipeCategory; no tag table until M4, kept only inside the draft. */
  tags: string[];
  /** Absolute https URL of the cover image, or null. Downloaded on save (T8), never hotlinked. */
  cover_image_url: string | null;
};

export type NormalizeResult = {
  /** null when the node lacks a title, ingredients or steps: that is `no_recipe`, not a partial draft. */
  draft: Draft | null;
  warnings: string[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];

const MAX_INGREDIENTS = 200;
const MAX_STEPS = 100;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 40;
const MAX_STEP_DEPTH = 4;

/** Text of a string, or of the `name`/`text` of a Thing. */
const MAX_TEXT_DEPTH = 3;

function textOf(v: unknown, maxLen: number, multiline = false, depth = 0): string {
  if (depth > MAX_TEXT_DEPTH) return '';
  if (typeof v === 'string') return sanitizeText(v, { maxLen, multiline });
  if (typeof v === 'number') return String(v);
  if (isObj(v)) return textOf(v['name'] ?? v['text'], maxLen, multiline, depth + 1);
  return '';
}

function parseYield(
  v: unknown,
  warnings: string[],
): { servings: number | null; label: string | null } {
  const candidates = arr(v)
    .map((x) => (typeof x === 'number' ? String(x) : textOf(x, 100)))
    .filter(Boolean);
  const withDigit = candidates.filter((c) => /\d/.test(c));
  // Prefer the entry that also carries a label ("8 slices") over a bare number ("8").
  const pick = withDigit.find((c) => /[^\d\s.,-]/.test(c)) ?? withDigit[0] ?? candidates[0];
  if (!pick) return { servings: null, label: null };
  const m = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?/.exec(pick);
  if (!m) {
    warnings.push('yield_unparsed');
    return { servings: null, label: null };
  }
  const n = parseFloat(m[1]!.replace(',', '.'));
  const rest = (pick.slice(0, m.index) + ' ' + pick.slice(m.index + m[0].length))
    .replace(/\b(makes|serves|serving size|yields?|for|about|approx\.?|approximately)\b/gi, ' ')
    .replace(/[:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!Number.isFinite(n) || n <= 0 || n > 10_000) {
    warnings.push('yield_unparsed');
    return { servings: null, label: null };
  }
  return { servings: n, label: rest ? rest.slice(0, 60) : null };
}

function stepLabel(text: string): string {
  const words = text
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .split(/\s+/)
    .slice(0, 3)
    .join(' ');
  const cleaned = words.replace(/[.,;:!?]+$/, '');
  return (cleaned.length > 24 ? cleaned.slice(0, 24).trim() : cleaned) || text.slice(0, 24).trim();
}

type RawStep = { text: string; prefix: string | null };

function collectSteps(v: unknown, out: RawStep[], prefix: string | null, depth: number): void {
  if (depth > MAX_STEP_DEPTH || out.length >= MAX_STEPS) return;
  if (typeof v === 'string') {
    const t = sanitizeText(v, { maxLen: 8000, multiline: true });
    for (const line of t.split('\n')) {
      const l = line.replace(/^\s*(?:step\s*)?\d{1,2}\s*[.):-]\s+/i, '').trim();
      if (l) out.push({ text: l.slice(0, 4000), prefix });
    }
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectSteps(x, out, prefix, depth + 1);
    return;
  }
  if (!isObj(v)) return;
  const type = arr(v['@type']).map(String).join(' ');
  if (
    /HowToSection/.test(type) ||
    (v['itemListElement'] !== undefined && v['text'] === undefined)
  ) {
    const name = sanitizeText(v['name'], { maxLen: 80 });
    collectSteps(v['itemListElement'], out, name || prefix, depth + 1);
    return;
  }
  const t = sanitizeText(v['text'] ?? v['description'] ?? v['name'], {
    maxLen: 4000,
    multiline: true,
  });
  if (t) out.push({ text: t, prefix });
}

function hostName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

function coverUrl(image: unknown, base: string | null, depth = 0): string | null {
  if (depth > 3) return null;
  for (const x of arr(image)) {
    const raw = typeof x === 'string' ? x : isObj(x) ? (x['url'] ?? x['contentUrl']) : null;
    const nested = isObj(x) && raw === undefined ? coverUrl(x['image'], base, depth + 1) : null;
    const abs = sanitizeUrl(raw, base ?? undefined) ?? nested;
    if (abs) return abs.replace(/^http:\/\//i, 'https://');
  }
  return null;
}

function collectTags(node: Obj): string[] {
  const parts: string[] = [];
  for (const v of [node['keywords'], node['recipeCategory']]) {
    for (const x of arr(v).slice(0, MAX_TAGS * 4)) {
      if (typeof x === 'string') parts.push(...x.split(/[,;]/));
      else if (isObj(x)) parts.push(textOf(x, 80));
    }
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const p of parts.slice(0, MAX_TAGS * 4)) {
    const t = sanitizeText(p, { maxLen: MAX_TAG_LEN });
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

export function normalizeRecipe(
  node: Obj,
  opts: { sourceUrl?: string | null } = {},
): NormalizeResult {
  const warnings: string[] = [];
  const sourceUrl = sanitizeUrl(opts.sourceUrl ?? null);

  const title = textOf(node['name'] ?? node['headline'], 200);

  // Ingredients
  // Slice before sanitizing (+1 keeps the truncation warning); bounds CPU on huge arrays.
  const rawIngredients = arr(node['recipeIngredient'] ?? node['ingredients'])
    .slice(0, MAX_INGREDIENTS + 1)
    .flatMap((x) => (typeof x === 'string' ? x.split(/\r?\n/) : [textOf(x, 500)]));
  const lines = rawIngredients.map((l) => sanitizeText(l, { maxLen: 500 })).filter(Boolean);
  if (lines.length > MAX_INGREDIENTS) warnings.push('ingredients_truncated');
  let unparsed = 0;
  const ingredients = lines.slice(0, MAX_INGREDIENTS).map((line) => {
    const p = parseIngredientLine(line);
    if (p.unparsed) unparsed++;
    const f = toIngredientFields(p);
    return { ...f, name: f.name.slice(0, 200), note: f.note?.slice(0, 300) ?? null };
  });
  if (unparsed > 0) warnings.push(`ingredients_unparsed:${unparsed}`);

  // Steps
  const rawSteps: RawStep[] = [];
  collectSteps(node['recipeInstructions'], rawSteps, null, 0);
  if (rawSteps.length >= MAX_STEPS) warnings.push('steps_truncated');
  const steps = rawSteps.slice(0, MAX_STEPS).map((s) => ({
    kind: 'column' as const,
    label: stepLabel(s.text),
    detail: (s.prefix ? `${s.prefix}: ${s.text}` : s.text).slice(0, 4000),
    row_start: null,
    row_end: null,
  }));

  if (!title || ingredients.length === 0 || steps.length === 0) {
    return { draft: null, warnings };
  }

  const y = parseYield(node['recipeYield'], warnings);
  const prep = isoDurationToMinutes(node['prepTime']);
  const cook = isoDurationToMinutes(node['cookTime']);
  for (const k of ['prepTime', 'cookTime'] as const) {
    if (node[k] !== undefined && isoDurationToMinutes(node[k]) === null)
      warnings.push(`${k}_invalid`);
  }
  if (prep === null && cook === null) warnings.push('times_missing');
  // totalTime is derived data: only prep/cook are kept.

  const publisher = textOf(node['publisher'], 200);
  const author = textOf(node['author'], 200);
  const cover = coverUrl(node['image'], sourceUrl);
  if (node['image'] !== undefined && !cover) warnings.push('image_dropped');

  const candidate = {
    title,
    description: textOf(node['description'], 5000, true) || null,
    servings: y.servings,
    servings_label: y.label,
    prep_minutes: prep,
    cook_minutes: cook,
    source_url: sourceUrl,
    source_name: (publisher || hostName(sourceUrl) || author || null)?.slice(0, 200) ?? null,
    visibility: 'private' as const,
    view_mode: 'list' as const,
    sections: [{ title: null, ingredients, steps }],
  };
  const parsed = recipeInputSchema.safeParse(candidate);
  if (!parsed.success) {
    warnings.push('draft_invalid');
    return { draft: null, warnings };
  }
  return {
    draft: { ...parsed.data, tags: collectTags(node), cover_image_url: cover },
    warnings,
  };
}
