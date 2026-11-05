type T = (key: string, values?: Record<string, string | number>) => string;

// Full literal keys so the catalogue test sees them. Unknown server warnings get the generic text.
const KEYS: Record<string, string> = {
  yield_unparsed: 'import.warning.yield_unparsed',
  ingredients_truncated: 'import.warning.ingredients_truncated',
  steps_truncated: 'import.warning.steps_truncated',
  prepTime_invalid: 'import.warning.prepTime_invalid',
  cookTime_invalid: 'import.warning.cookTime_invalid',
  times_missing: 'import.warning.times_missing',
  image_dropped: 'import.warning.image_dropped',
  draft_invalid: 'import.warning.draft_invalid',
};

/** Warning codes are server-defined ("ingredients_unparsed:3"); the text always comes from the catalogue. */
export function warningMessage(t: T, code: string): string {
  const m = /^ingredients_unparsed:(\d+)$/.exec(code);
  if (m) return t('import.warning.ingredients_unparsed', { count: Number(m[1]) });
  const key = KEYS[code];
  return key ? t(key) : t('import.warning.generic');
}
