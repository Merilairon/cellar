// Tag name rules (tasklist G5, owner decision Q7). Pure: shared by the zod schema (client and
// server), the import save path and the data layer, so every route into the `tag` table
// applies the same normalization.

export const MAX_TAG_LEN = 40;
export const MAX_TAGS_PER_RECIPE = 20;

const CONTROL = /\p{Cc}/u;

/**
 * Trim, collapse inner whitespace, Unicode NFC, lowercase. The stored name is the lowercase
 * form, so "Dessert" and "dessert" are one tag. Returns null when the result is empty, longer
 * than 40 characters (code points, as SQLite counts them) or contains a control character.
 */
export function normalizeTagName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const spaced = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  // Lowercasing can change composition and length, so normalize again and measure last.
  const name = spaced.toLowerCase().normalize('NFC');
  if (name === '' || CONTROL.test(name)) return null;
  if ([...name].length > MAX_TAG_LEN) return null;
  return name;
}

/** Lenient list form for untrusted-but-not-user-facing input: drops invalid names, dedupes, caps. */
export function normalizeTagList(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const n = normalizeTagName(r);
    if (n !== null && !out.includes(n)) out.push(n);
    if (out.length >= MAX_TAGS_PER_RECIPE) break;
  }
  return out;
}
