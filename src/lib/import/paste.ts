import { extractRecipeNode } from './extract-jsonld';
import { sanitizeText } from './sanitize';

// Paste mode (data-model G16): page HTML or JSON-LD goes through the normal extractor;
// anything else is split by a deliberately simple heading-based splitter. No heuristics
// beyond that (the auto-mapper in 3b is the place for those).

export const MAX_PASTE_CHARS = 500_000;

const ING_HEADING = /^(?:#{1,6}\s*)?(?:ingredients?)\s*:?\s*$/i;
const STEP_HEADING =
  /^(?:#{1,6}\s*)?(?:instructions?|directions?|method|steps?|preparation)\s*:?\s*$/i;

export type PasteKind = 'html' | 'jsonld' | 'text';

export function detectPasteKind(text: string): PasteKind {
  const t = text.trimStart();
  if (t.startsWith('<') || /ld\+json/i.test(text)) return 'html';
  if (/^[{[]/.test(t) && /"@type"/.test(text)) return 'jsonld';
  return 'text';
}

type Node = Record<string, unknown>;

/** Heading-based splitter over plain text. Null when no title or no both headings. */
export function splitPlainText(text: string): Node | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0];
  if (!first || ING_HEADING.test(first) || STEP_HEADING.test(first)) return null;
  const ingredients: string[] = [];
  const steps: string[] = [];
  let mode: 'none' | 'ing' | 'step' = 'none';
  for (const line of lines.slice(1)) {
    if (ING_HEADING.test(line)) mode = 'ing';
    else if (STEP_HEADING.test(line)) mode = 'step';
    else if (mode === 'ing') ingredients.push(line);
    else if (mode === 'step') steps.push(line);
  }
  if (ingredients.length === 0 || steps.length === 0) return null;
  return {
    '@type': 'Recipe',
    name: first,
    recipeIngredient: ingredients,
    recipeInstructions: steps,
  };
}

/** Recipe node from pasted content, or null (the caller maps null to `no_recipe`). */
export function recipeNodeFromPaste(text: string): { node: Node | null; notes: string[] } {
  const kind = detectPasteKind(text);
  if (kind === 'jsonld') {
    const r = extractRecipeNode(`<script type="application/ld+json">${text}</script>`);
    return { node: r.node, notes: r.notes };
  }
  if (kind === 'html') {
    const r = extractRecipeNode(text);
    if (r.node) return { node: r.node, notes: r.notes };
    // No JSON-LD in the pasted page: try the heading splitter on its visible text.
    const visible = sanitizeText(text, { maxLen: MAX_PASTE_CHARS, multiline: true });
    return { node: splitPlainText(visible), notes: [...r.notes, 'html_text_fallback'] };
  }
  return {
    node: splitPlainText(sanitizeText(text, { maxLen: MAX_PASTE_CHARS, multiline: true })),
    notes: [],
  };
}
