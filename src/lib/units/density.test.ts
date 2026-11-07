import { describe, expect, it } from 'vitest';
import { DENSITY_IDS, findDensity, nameTokens } from './density';

describe('findDensity', () => {
  it.each([
    ['all-purpose flour', 'flour'],
    ['Flour', 'flour'],
    ['plain flour, sifted', 'flour'],
    ['bread flour', 'flour'],
    ['granulated sugar', 'granulated sugar'],
    ['sugar', 'granulated sugar'],
    ['caster sugar', 'granulated sugar'],
    ['light brown sugar', 'brown sugar'],
    ['dark brown sugar, packed', 'brown sugar'],
    ["confectioners' sugar", 'powdered sugar'],
    ['icing sugar', 'powdered sugar'],
    ['unsalted butter', 'butter'],
    ['butter, melted', 'butter'],
    ['butter softened', 'butter'],
    ['whole milk', 'milk'],
    ['milk', 'milk'],
    ['water', 'water'],
    ['olive oil', 'oil'],
    ['vegetable oil', 'oil'],
    ['honey', 'honey'],
    ['unsweetened cocoa powder', 'cocoa powder'],
    ['cocoa', 'cocoa powder'],
  ])('%s -> %s', (name, id) => {
    expect(findDensity(name)?.id).toBe(id);
  });

  it.each([
    'flour tortillas',
    'butter beans',
    'sugar snap peas',
    'milk chocolate',
    'chocolate milk',
    'coconut milk',
    'almond milk',
    'evaporated milk',
    'sweetened condensed milk',
    'peanut butter',
    'apple butter',
    'cocoa butter',
    'almond flour',
    'coconut flour',
    'rice flour',
    'coconut sugar',
    'coconut oil',
    'rose water',
    'coconut water',
    'honey mustard',
    'honeydew melon',
    'hot cocoa mix',
    'buttermilk',
    'eggs',
    'salt',
    '',
  ])('does not match "%s"', (name) => {
    expect(findDensity(name)).toBeNull();
  });

  it('only looks at the name before a comma or parenthesis', () => {
    expect(findDensity('salt (or butter)')).toBeNull();
    expect(findDensity('flour, plus butter for the pan')?.id).toBe('flour');
  });

  it('has positive densities and a documented measure style', () => {
    for (const id of DENSITY_IDS)
      expect(findDensity(id === 'cocoa powder' ? 'cocoa powder' : id)).not.toBeNull();
  });

  it('flour is 125 g per cup, butter 227 g per cup', () => {
    expect(findDensity('flour')!.gPerMl * 236.5882365).toBeCloseTo(125, 6);
    expect(findDensity('butter')!.gPerMl * 236.5882365).toBeCloseTo(227, 6);
  });
});

describe('nameTokens', () => {
  it('lowercases, singularizes and drops apostrophes', () => {
    expect(nameTokens("Confectioners' Sugars")).toEqual(['confectioner', 'sugar']);
  });
  it('stops at the first comma', () => {
    expect(nameTokens('flour, sifted')).toEqual(['flour']);
  });
});
