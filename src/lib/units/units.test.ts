import { describe, expect, it } from 'vitest';
import { parseIngredientLine, unitSystem } from '../import/ingredient-parser';
import { UNIT_TABLE, findUnit, lookupAlias } from './units';
import { dimensionOf, systemOf } from './convert';

describe('unit table', () => {
  it('has unique ids and positive factors', () => {
    const ids = UNIT_TABLE.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const u of UNIT_TABLE) expect(u.factor).toBeGreaterThan(0);
  });

  it('uses 1 as the factor of the canonical units g and mL', () => {
    expect(findUnit('g')?.factor).toBe(1);
    expect(findUnit('mL')?.factor).toBe(1);
  });

  it('has no alias claimed by two units', () => {
    const seen = new Map<string, string>();
    for (const u of UNIT_TABLE)
      for (const a of u.aliases) {
        expect(seen.get(a), a).toBeUndefined();
        seen.set(a, u.id);
      }
  });

  it.each([
    ['Tbsp.', 'tbsp'],
    ['TBSP', 'tbsp'],
    ['cups', 'cup'],
    ['ML', 'mL'],
    ['mL', 'mL'],
    ['fl oz', 'fl oz'],
    ['Ounces', 'oz'],
    ['lbs', 'lb'],
    ['l', 'L'],
  ])('findUnit(%s) -> %s', (raw, id) => {
    expect(findUnit(raw)?.id).toBe(id);
  });

  it.each([null, undefined, '', 'clove', 'can', 'pinch', 'banana'])(
    'findUnit(%s) is null',
    (raw) => {
      expect(findUnit(raw)).toBeNull();
    },
  );

  it('dimensionOf and systemOf agree with the table', () => {
    expect(dimensionOf('oz')).toBe('mass');
    expect(dimensionOf('cup')).toBe('volume');
    expect(systemOf('kg')).toBe('metric');
    expect(systemOf('tsp')).toBe('us');
    expect(dimensionOf('clove')).toBeNull();
    expect(systemOf(null)).toBeNull();
  });

  it('lookupAlias only answers for parser words', () => {
    expect(lookupAlias('tablespoons')?.id).toBe('tbsp');
    expect(lookupAlias('fl oz')).toBeNull();
    expect(lookupAlias('clove')).toBeNull();
  });
});

describe('drift guard: the parser and the units module share one table', () => {
  const aliases = UNIT_TABLE.flatMap((u) => u.aliases.map((a) => [a, u] as const));

  it.each(aliases)('parser reads "1 %s" as the table unit', (alias, def) => {
    const p = parseIngredientLine(`1 ${alias} stuff`);
    expect(p.unit).toBe(def.id);
    expect(unitSystem(alias)).toBe(def.system);
  });

  it('parser reads "fl oz" and "fluid ounce" as the table id', () => {
    for (const line of ['2 fl oz milk', '2 fluid ounces milk']) {
      const unit = parseIngredientLine(line).unit;
      expect(findUnit(unit)?.id).toBe('fl oz');
    }
  });

  it('every unit the parser can produce is known to the units module', () => {
    for (const [alias] of aliases) {
      const unit = parseIngredientLine(`3 ${alias} x`).unit;
      expect(findUnit(unit), alias).not.toBeNull();
    }
  });
});
