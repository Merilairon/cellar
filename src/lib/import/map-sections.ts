// Section and heading detection (tasklist G16, requirement 12). Linear scanners and Set
// lookups only: no regex is built from input and none runs over whole inputs.

import { parseIngredientLine, toIngredientFields } from './ingredient-parser';
import { MAP_LIMITS, type MapStepInput } from './map-types';
import { safeSlice, singularize, tokenize } from './text-tokens';
import { VERBS } from './step-verbs';
import type { IngredientInput } from '@/lib/recipes/schemas';

const MAX_HEADING_CHARS = 60;
const MAX_TITLE_WORDS = 5;
/** Per-line cap before an ingredient line reaches the parser (matches raw_text). */
const MAX_LINE_CHARS = 500;

const NOT_A_TITLE = new Set(['best', 'results', 'result', 'tip', 'tips', 'note', 'notes', 'sake']);
const PREFIXES: ReadonlyArray<readonly string[]> = [
  ['for', 'the'],
  ['to', 'make', 'the'],
  ['make', 'the'],
  ['prepare', 'the'],
];

const hasDigit = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) return true;
  }
  return false;
};

function splitWords(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length && out.length < 40; i++) {
    const ch = s[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Title comparison key: prefixes and trailing "instructions" removed, singular tokens. */
export function titleKey(title: string): string {
  let w = tokenize(title);
  for (const p of PREFIXES) {
    if (w.length > p.length && p.every((x, i) => w[i] === x)) {
      w = w.slice(p.length);
      break;
    }
  }
  if (w.length > 1 && w[w.length - 1] === 'instructions') w = w.slice(0, -1);
  return w.map(singularize).join(' ');
}

function validTitleWords(words: string[], firstMayBeVerb: boolean): boolean {
  if (words.length < 1 || words.length > MAX_TITLE_WORDS) return false;
  for (let i = 0; i < words.length; i++) {
    const lw = words[i]!.toLowerCase();
    if (lw.includes(',') || hasDigit(lw)) return false;
    // "Cream cheese frosting" may start with a verb word; "best results chill" may not hide one.
    if (VERBS.has(lw) && !(i === 0 && firstMayBeVerb)) return false;
    if (NOT_A_TITLE.has(lw)) return false;
  }
  return true;
}

/**
 * Title of a heading line inside the step stream, or null when the line is a step.
 * `known` holds title keys (see titleKey) that make a bare word a heading.
 */
export function stepHeadingTitle(line: string, known?: ReadonlySet<string>): string | null {
  const raw = String(line).trim();
  if (raw.length === 0 || raw.length > MAX_HEADING_CHARS) return null;
  const last = raw[raw.length - 1]!;
  if (last === '.' || last === '!' || last === '?') return null;
  const colon = last === ':';
  const body = colon ? raw.slice(0, -1).trim() : raw;
  const words = splitWords(body);
  if (words.length === 0 || words.length > MAX_TITLE_WORDS + 3) return null;
  const lower = words.map((w) => w.toLowerCase());
  for (const p of PREFIXES) {
    if (lower.length > p.length && p.every((x, i) => lower[i] === x)) {
      const x = words.slice(p.length);
      return validTitleWords(x, true) ? capitalize(x.join(' ')) : null;
    }
  }
  if (lower.length > 1 && lower[lower.length - 1] === 'instructions') {
    const x = words.slice(0, -1);
    return validTitleWords(x, true) ? capitalize(x.join(' ')) : null;
  }
  if (colon && validTitleWords(words, false)) return capitalize(words.join(' '));
  if (known && known.has(titleKey(body))) return capitalize(body);
  return null;
}

/** "Make the X" / "Prepare the X" / "To make the X" without a colon: also a common ordinary first step. */
const AMBIGUOUS_PREFIXES = PREFIXES.filter((p) => p[0] !== 'for');
export function isAmbiguousStepHeading(line: string): boolean {
  const raw = String(line).trim();
  if (raw.endsWith(':')) return false;
  const lower = splitWords(raw).map((w) => w.toLowerCase());
  return AMBIGUOUS_PREFIXES.some(
    (p) => lower.length > p.length && p.every((x, i) => lower[i] === x),
  );
}

/**
 * Heading title per step line (null = ordinary step). An ambiguous `Make the X` line is a
 * heading only when it ends with `:` or the recipe has another heading (a hint or a
 * non-ambiguous heading line); otherwise it stays a step.
 */
export function resolveStepHeadings(
  steps: ReadonlyArray<{ text: string; section: string | null }>,
  known?: ReadonlySet<string>,
): Array<string | null> {
  const raw = steps.map((st) =>
    st.section !== null && st.section.trim() !== '' ? null : stepHeadingTitle(st.text, known),
  );
  const strong =
    steps.some((st) => st.section !== null && st.section.trim() !== '') ||
    raw.some((t, i) => t !== null && !isAmbiguousStepHeading(steps[i]!.text));
  return raw.map((t, i) =>
    t !== null && isAmbiguousStepHeading(steps[i]!.text) && !strong ? null : t,
  );
}

export const isStepHeading = (line: string, known?: ReadonlySet<string>): boolean =>
  stepHeadingTitle(line, known) !== null;

/**
 * Title of an ingredient group heading ("For the frosting:", "Sauce:"), or null. A line with
 * a digit is a quantity line. A bare word is a heading only when it matches `known`.
 */
export function ingredientHeadingTitle(line: string, known?: ReadonlySet<string>): string | null {
  const raw = String(line).trim();
  if (raw.length === 0 || raw.length > MAX_HEADING_CHARS || hasDigit(raw)) return null;
  if (raw.includes(',')) return null;
  const colon = raw.endsWith(':');
  const body = colon ? raw.slice(0, -1).trim() : raw;
  const words = splitWords(body);
  if (words.length === 0 || words.length > MAX_TITLE_WORDS + 3) return null;
  const lower = words.map((w) => w.toLowerCase());
  const forThe = lower.length > 2 && lower[0] === 'for' && lower[1] === 'the';
  if (forThe) return capitalize(words.slice(2).join(' '));
  if (colon) return capitalize(body);
  if (known && known.has(titleKey(body))) return capitalize(body);
  return null;
}

export const isIngredientHeading = (line: string, known?: ReadonlySet<string>): boolean =>
  ingredientHeadingTitle(line, known) !== null;

/**
 * Parse ingredient lines into inputs. Heading lines are removed and recorded as
 * `group_label` on the lines that follow them (G16).
 */
export function ingredientsFromLines(
  lines: readonly string[],
  known?: ReadonlySet<string>,
): IngredientInput[] {
  const out: IngredientInput[] = [];
  let label: string | null = null;
  for (const rawLine of lines.slice(0, MAP_LIMITS.ingredients * 2)) {
    const line = safeSlice(String(rawLine), MAX_LINE_CHARS);
    const heading = ingredientHeadingTitle(line, known);
    if (heading !== null) {
      label = safeSlice(heading, 120);
      continue;
    }
    if (out.length >= MAP_LIMITS.ingredients) break;
    const f = toIngredientFields(parseIngredientLine(line));
    out.push({
      name: safeSlice(f.name, MAP_LIMITS.ingredientNameChars) || 'ingredient',
      note: f.note,
      raw_text: safeSlice(f.raw_text, MAX_LINE_CHARS),
      metric_qty: f.metric_qty,
      metric_qty_max: f.metric_qty_max,
      metric_unit: f.metric_unit,
      us_qty: f.us_qty,
      us_qty_max: f.us_qty_max,
      us_unit: f.us_unit,
      display_primary: f.display_primary,
      split_group_id: null,
      portion_label: null,
      group_label: label,
    });
  }
  return out;
}

export type StepGroup = { title: string | null; steps: string[] };

/**
 * Group steps into sections. A step hint (HowToSection name) starts a group when it changes;
 * heading lines start a group and are removed from the step list. Empty groups are dropped.
 */
export function groupSteps(steps: readonly MapStepInput[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let cur: StepGroup | null = null;
  let curHint: string | null = null;
  const headings = resolveStepHeadings(steps);
  for (const [i, st] of steps.entries()) {
    const hint =
      st.section !== null && st.section.trim() !== '' ? safeSlice(st.section.trim(), 120) : null;
    if (hint !== null) {
      if (cur === null || curHint !== hint) {
        cur = { title: hint, steps: [] };
        curHint = hint;
        groups.push(cur);
      }
      cur.steps.push(st.text);
      continue;
    }
    const title = headings[i] ?? null;
    if (title !== null) {
      cur = { title: safeSlice(title, 120), steps: [] };
      curHint = null;
      groups.push(cur);
      continue;
    }
    if (cur === null) {
      cur = { title: null, steps: [] };
      groups.push(cur);
    }
    cur.steps.push(st.text);
  }
  return groups.filter((g) => g.steps.length > 0);
}

export type SectionWarning =
  'sections_from_ingredients_only' | 'ingredient_shared_across_sections' | 'section_merged';

export type AssignedSection = {
  title: string | null;
  steps: string[];
  /** Indices into the ingredient array, in input order. */
  ingredients: number[];
};

export type Assignment = {
  tooMany: boolean;
  sections: AssignedSection[];
  warnings: SectionWarning[];
};

/**
 * Assign ingredients to step groups (G16). Labels that match a group title win; otherwise
 * the first group whose steps mention the ingredient (`mentionedIn(g)` gives the indices
 * mentioned by group g); otherwise group 0. Empty sections merge into a neighbour.
 */
export function assignIngredients(
  groups: readonly StepGroup[],
  ingredients: ReadonlyArray<{ group_label?: string | null }>,
  mentionedIn?: (group: number) => ReadonlySet<number>,
): Assignment {
  const warnings = new Set<SectionWarning>();
  if (groups.length > MAP_LIMITS.sections) return { tooMany: true, sections: [], warnings: [] };
  if (groups.length <= 1) {
    const g = groups[0] ?? { title: null, steps: [] };
    if (g.title === null && ingredients.some((i) => i.group_label)) {
      warnings.add('sections_from_ingredients_only');
    }
    return {
      tooMany: false,
      sections: [
        { title: g.title, steps: [...g.steps], ingredients: ingredients.map((_, i) => i) },
      ],
      warnings: [...warnings],
    };
  }
  const keys = groups.map((g) => (g.title === null ? '' : titleKey(g.title)));
  const mentions = groups.map((_, g) => (mentionedIn ? mentionedIn(g) : new Set<number>()));
  const assigned: number[][] = groups.map(() => []);
  ingredients.forEach((ing, i) => {
    const label = ing.group_label ? titleKey(ing.group_label) : '';
    let g = label ? keys.indexOf(label) : -1;
    if (g < 0) {
      const hits = mentions.map((m, gi) => (m.has(i) ? gi : -1)).filter((x) => x >= 0);
      if (hits.length > 1) warnings.add('ingredient_shared_across_sections');
      g = hits.length > 0 ? hits[0]! : 0;
    }
    assigned[g]!.push(i);
  });
  const out: AssignedSection[] = [];
  let pending: string[] = [];
  groups.forEach((g, gi) => {
    if (assigned[gi]!.length === 0) {
      warnings.add('section_merged');
      if (out.length > 0) out[out.length - 1]!.steps.push(...g.steps);
      else pending = pending.concat(g.steps);
      return;
    }
    out.push({ title: g.title, steps: [...pending, ...g.steps], ingredients: assigned[gi]! });
    pending = [];
  });
  return { tooMany: false, sections: out, warnings: [...warnings] };
}
