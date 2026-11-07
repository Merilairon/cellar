import { MAX_TAG_LEN, MAX_TAGS_PER_RECIPE, normalizeTagName } from './tag-name';

// Pure logic behind the tag field (T10). No react, no DOM: the component only wires events to
// these functions, so the rules are tested without a browser. Normalization is the shared
// normalizeTagName, so the client accepts exactly what the server accepts.

export type TagProblem = 'too_long' | 'invalid';
export type TagAddProblem = TagProblem | 'empty' | 'limit';

export const AUTOCOMPLETE_DEBOUNCE_MS = 200;
export const MAX_SUGGESTIONS = 10;

const collapse = (raw: string): string => raw.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** Why this text can never be a tag (null for blank text and for valid text). */
export function tagProblem(raw: string): TagProblem | null {
  const text = collapse(raw);
  if (text === '') return null;
  if (normalizeTagName(text) !== null) return null;
  // Length is measured on the lowercased form, as the server does (lowercasing can change it).
  return [...text.toLowerCase().normalize('NFC')].length > MAX_TAG_LEN ? 'too_long' : 'invalid';
}

export type AddResult =
  | { ok: true; tags: string[]; name: string; added: boolean }
  | { ok: false; problem: TagAddProblem };

/** Add one tag. A duplicate (any case or spacing variant) collapses: ok with added false. */
export function addTag(tags: readonly string[], raw: string): AddResult {
  if (collapse(raw) === '') return { ok: false, problem: 'empty' };
  const name = normalizeTagName(raw);
  if (name === null) return { ok: false, problem: tagProblem(raw) ?? 'invalid' };
  if (tags.includes(name)) return { ok: true, tags: [...tags], name, added: false };
  if (tags.length >= MAX_TAGS_PER_RECIPE) return { ok: false, problem: 'limit' };
  return { ok: true, tags: [...tags, name], name, added: true };
}

/** Comma separated text (typed or pasted) to candidate names; blanks dropped. */
export const splitTagText = (text: string): string[] =>
  text
    .split(/[,\n;]/u)
    .map((p) => p.trim())
    .filter(Boolean);

export type AddManyResult = {
  tags: string[];
  added: string[];
  rejected: string[];
  problem?: TagAddProblem;
};

/** Add every candidate in `text`; rejected ones are returned so their text can stay in the input. */
export function addMany(tags: readonly string[], text: string): AddManyResult {
  let cur = [...tags];
  const added: string[] = [];
  const rejected: string[] = [];
  let problem: TagAddProblem | undefined;
  for (const part of splitTagText(text)) {
    const r = addTag(cur, part);
    if (r.ok) {
      cur = r.tags;
      if (r.added) added.push(r.name);
    } else {
      rejected.push(part);
      problem ??= r.problem;
    }
  }
  return { tags: cur, added, rejected, problem };
}

export const removeTag = (tags: readonly string[], name: string): string[] =>
  tags.filter((t) => t !== name);

/** Suggestions the user can still pick: not already chosen, deduped, capped. */
export function visibleSuggestions(
  suggestions: readonly string[],
  tags: readonly string[],
): string[] {
  const out: string[] = [];
  for (const s of suggestions) {
    if (!tags.includes(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Next active option for ArrowDown / ArrowUp; wraps, -1 means "no option active". */
export function moveActive(current: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

/** Tag names from a GET /api/tags body; anything malformed yields no suggestions. */
export function parseTagsResponse(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const list = (body as { tags?: unknown }).tags;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const name = (item as { name?: unknown } | null)?.name;
    if (typeof name === 'string') out.push(name);
  }
  return out;
}

/** The autocomplete URL for typed text, or null when nothing should be fetched. */
export function autocompleteUrl(text: string): string | null {
  const q = collapse(text).toLowerCase();
  if (q === '' || tagProblem(q) !== null) return null;
  return `/api/tags?q=${encodeURIComponent(q)}`;
}

/** Tag names for the url, or null on any failure (autocomplete is a convenience). */
export async function fetchTagNames(url: string, signal: AbortSignal): Promise<string[] | null> {
  try {
    const res = await fetch(url, { signal });
    return res.ok ? parseTagsResponse(await res.json()) : null;
  } catch {
    return null;
  }
}
