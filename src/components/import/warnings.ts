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
  headless_used: 'import.warning.headless_used',
  draft_invalid: 'import.warning.draft_invalid',
  // Mapper codes (closed set, see MappingWarning).
  ingredient_unmentioned: 'import.warning.ingredient_unmentioned',
  ambiguous_name: 'import.warning.ambiguous_name',
  split_unresolved: 'import.warning.split_unresolved',
  group_reference: 'import.warning.group_reference',
  step_without_ingredients: 'import.warning.step_without_ingredients',
  sections_from_ingredients_only: 'import.warning.sections_from_ingredients_only',
  section_merged: 'import.warning.section_merged',
  ingredient_shared_across_sections: 'import.warning.ingredient_shared_across_sections',
  too_many_sections: 'import.warning.too_many_sections',
  input_truncated: 'import.warning.input_truncated',
  time_ambiguous: 'import.warning.time_ambiguous',
  mapping_invalid: 'import.warning.mapping_invalid',
  mapping_budget: 'import.warning.mapping_budget',
  mapping_too_large: 'import.warning.mapping_too_large',
};

/** Codes whose suffix is page text (an ingredient name or token), passed as an ICU value. */
const TEXT_SUFFIX: Record<string, 'name' | 'token'> = {
  ingredient_unmentioned: 'name',
  ambiguous_name: 'token',
  split_unresolved: 'name',
};

/**
 * Warning codes are server-defined ("ingredients_unparsed:3", "ambiguous_name:egg"); the text
 * always comes from the catalogue and any page text is passed as a value, never as markup.
 */
export function warningMessage(t: T, code: string): string {
  const colon = code.indexOf(':');
  const base = colon < 0 ? code : code.slice(0, colon);
  const suffix = colon < 0 ? '' : code.slice(colon + 1);
  if (base === 'ingredients_unparsed' && /^\d+$/.test(suffix))
    return t('import.warning.ingredients_unparsed', { count: Number(suffix) });
  if (base === 'warnings_more' && /^\d+$/.test(suffix))
    return t('import.warning.warnings_more', { count: Number(suffix) });
  if (Object.hasOwn(TEXT_SUFFIX, base) && Object.hasOwn(KEYS, base))
    return t(KEYS[base], { [TEXT_SUFFIX[base]]: suffix });
  if (colon < 0 && Object.hasOwn(KEYS, code)) return t(KEYS[code]);
  return t('import.warning.generic');
}
