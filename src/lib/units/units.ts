// Unit table shared by the ingredient parser (alias lookup) and the conversion code.
// Pure: no I/O, no clock, no randomness. Factors convert to the canonical unit of the
// dimension (mass -> g, volume -> mL). US customary values (not imperial).

export type UnitSystem = 'metric' | 'us';
export type Dimension = 'mass' | 'volume';

export type UnitDef = {
  /** Canonical id as stored in the database. */
  id: string;
  system: UnitSystem;
  dimension: Dimension;
  /** Multiply by this to get the canonical unit (g or mL). */
  factor: number;
  /** Lowercase words the parser recognises as this unit. */
  aliases: readonly string[];
};

export const UNIT_TABLE: readonly UnitDef[] = [
  {
    id: 'g',
    system: 'metric',
    dimension: 'mass',
    factor: 1,
    aliases: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'],
  },
  {
    id: 'kg',
    system: 'metric',
    dimension: 'mass',
    factor: 1000,
    aliases: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'],
  },
  {
    id: 'mL',
    system: 'metric',
    dimension: 'volume',
    factor: 1,
    aliases: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  },
  {
    id: 'L',
    system: 'metric',
    dimension: 'volume',
    factor: 1000,
    aliases: ['l', 'liter', 'liters', 'litre', 'litres'],
  },
  // 1 oz = 28.349523125 g (avoirdupois), 1 lb = 453.59237 g (exact by definition).
  {
    id: 'oz',
    system: 'us',
    dimension: 'mass',
    factor: 28.349523125,
    aliases: ['oz', 'ounce', 'ounces'],
  },
  {
    id: 'lb',
    system: 'us',
    dimension: 'mass',
    factor: 453.59237,
    aliases: ['lb', 'lbs', 'pound', 'pounds'],
  },
  // US legal cup = 236.5882365 mL; tbsp = cup/16, tsp = cup/48, fl oz = cup/8.
  { id: 'cup', system: 'us', dimension: 'volume', factor: 236.5882365, aliases: ['cup', 'cups'] },
  {
    id: 'tbsp',
    system: 'us',
    dimension: 'volume',
    factor: 14.78676478125,
    aliases: ['tbsp', 'tbsps', 'tbs', 'tablespoon', 'tablespoons'],
  },
  {
    id: 'tsp',
    system: 'us',
    dimension: 'volume',
    factor: 4.92892159375,
    aliases: ['tsp', 'tsps', 'teaspoon', 'teaspoons'],
  },
  { id: 'fl oz', system: 'us', dimension: 'volume', factor: 29.5735295625, aliases: ['floz'] },
  {
    id: 'pt',
    system: 'us',
    dimension: 'volume',
    factor: 473.176473,
    aliases: ['pt', 'pint', 'pints'],
  },
  {
    id: 'qt',
    system: 'us',
    dimension: 'volume',
    factor: 946.352946,
    aliases: ['qt', 'quart', 'quarts'],
  },
  {
    id: 'gal',
    system: 'us',
    dimension: 'volume',
    factor: 3785.411784,
    aliases: ['gal', 'gallon', 'gallons'],
  },
];

const BY_KEY = new Map<string, UnitDef>();
for (const def of UNIT_TABLE) {
  BY_KEY.set(def.id.toLowerCase(), def);
  for (const a of def.aliases) BY_KEY.set(a, def);
}

/** Key form used for every lookup: trimmed, lowercase, periods removed ("Tbsp." -> "tbsp"). */
function key(unit: string): string {
  return unit.trim().toLowerCase().split('.').join('');
}

/** Alias lookup for a parser word only (no canonical-id spellings such as "fl oz"). */
export function lookupAlias(word: string): UnitDef | null {
  const def = BY_KEY.get(key(word));
  return def && def.aliases.includes(key(word)) ? def : null;
}

/** Resolve a stored id or any known alias to its definition; `null` for counts/unknown units. */
export function findUnit(unit: string | null | undefined): UnitDef | null {
  if (!unit) return null;
  return BY_KEY.get(key(unit)) ?? null;
}
