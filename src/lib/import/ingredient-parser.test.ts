import { describe, expect, it } from 'vitest';
import { parseIngredientLine, toIngredientFields } from './ingredient-parser';

type Exp = {
  qty: number | null;
  unit: string | null;
  name: string;
  note?: string | null;
  qtyMax?: number;
  altQty?: number;
  altUnit?: string;
  unparsed?: true;
};

const cases: Array<[string, string, Exp]> = [
  ['integer', '2 cups flour', { qty: 2, unit: 'cup', name: 'flour' }],
  ['decimal', '1.5 tsp salt', { qty: 1.5, unit: 'tsp', name: 'salt' }],
  ['leading-dot decimal', '.5 tsp vanilla', { qty: 0.5, unit: 'tsp', name: 'vanilla' }],
  ['ascii fraction', '1/2 cup sugar', { qty: 0.5, unit: 'cup', name: 'sugar' }],
  ['unicode half', '½ cup sugar', { qty: 0.5, unit: 'cup', name: 'sugar' }],
  ['mixed ascii', '1 1/2 cups milk', { qty: 1.5, unit: 'cup', name: 'milk' }],
  ['mixed unicode glued', '1½ cups milk', { qty: 1.5, unit: 'cup', name: 'milk' }],
  ['mixed unicode spaced', '2 ¾ cups flour', { qty: 2.75, unit: 'cup', name: 'flour' }],
  ['quarter', '¼ tsp nutmeg', { qty: 0.25, unit: 'tsp', name: 'nutmeg' }],
  ['third', '⅓ cup oil', { qty: 1 / 3, unit: 'cup', name: 'oil' }],
  ['two thirds', '⅔ cup oil', { qty: 2 / 3, unit: 'cup', name: 'oil' }],
  ['range hyphen', '2-3 tbsp honey', { qty: 2, qtyMax: 3, unit: 'tbsp', name: 'honey' }],
  ['range word', '2 to 3 tbsp honey', { qty: 2, qtyMax: 3, unit: 'tbsp', name: 'honey' }],
  ['range en dash', '2–3 cloves garlic', { qty: 2, qtyMax: 3, unit: 'cloves', name: 'garlic' }],
  [
    'dual cup then metric',
    '1 cup (200 g) sugar',
    { qty: 1, unit: 'cup', name: 'sugar', altQty: 200, altUnit: 'g' },
  ],
  [
    'dual metric then cup',
    '200 g (1 cup) sugar',
    { qty: 200, unit: 'g', name: 'sugar', altQty: 1, altUnit: 'cup' },
  ],
  [
    'dual after name',
    '1 cup flour (120 g)',
    { qty: 1, unit: 'cup', name: 'flour', altQty: 120, altUnit: 'g' },
  ],
  ['count with adjective', '2 large eggs', { qty: 2, unit: null, name: 'large eggs' }],
  ['bare count', '3 bananas', { qty: 3, unit: null, name: 'bananas' }],
  [
    'no quantity to taste',
    'salt to taste',
    { qty: null, unit: null, name: 'salt', note: 'to taste' },
  ],
  ['no quantity plain', 'Fresh basil', { qty: null, unit: null, name: 'Fresh basil' }],
  ['comma note', '4 oz butter, melted', { qty: 4, unit: 'oz', name: 'butter', note: 'melted' }],
  [
    'paren note',
    '2 cups spinach (packed)',
    { qty: 2, unit: 'cup', name: 'spinach', note: 'packed' },
  ],
  [
    'paren and comma note',
    '1 cup nuts (raw), chopped',
    { qty: 1, unit: 'cup', name: 'nuts', note: 'raw, chopped' },
  ],
  ['pinch of', 'a pinch of salt', { qty: 1, unit: 'pinch', name: 'salt' }],
  ['pinch with qty', '1 pinch salt', { qty: 1, unit: 'pinch', name: 'salt' }],
  [
    'container with size',
    '1 (14 oz) can tomatoes',
    { qty: 1, unit: 'can', name: 'tomatoes', note: '14 oz' },
  ],
  ['tbsp abbreviation', '2 tbsp olive oil', { qty: 2, unit: 'tbsp', name: 'olive oil' }],
  ['tablespoons plural', '3 tablespoons butter', { qty: 3, unit: 'tbsp', name: 'butter' }],
  ['capitalised dotted tsp', '1 Tsp. cinnamon', { qty: 1, unit: 'tsp', name: 'cinnamon' }],
  ['oz', '8 oz cream cheese', { qty: 8, unit: 'oz', name: 'cream cheese' }],
  ['ounces', '8 ounces cream cheese', { qty: 8, unit: 'oz', name: 'cream cheese' }],
  ['uppercase', '2 CUPS FLOUR', { qty: 2, unit: 'cup', name: 'FLOUR' }],
  ['extra whitespace', '  1   cup \t sugar  ', { qty: 1, unit: 'cup', name: 'sugar' }],
  ['fl oz', '4 fl oz cream', { qty: 4, unit: 'fl oz', name: 'cream' }],
  ['fluid ounces', '4 fluid ounces cream', { qty: 4, unit: 'fl oz', name: 'cream' }],
  ['grams', '115 grams butter', { qty: 115, unit: 'g', name: 'butter' }],
  ['kg', '1 kg potatoes', { qty: 1, unit: 'kg', name: 'potatoes' }],
  ['ml', '250 ml milk', { qty: 250, unit: 'mL', name: 'milk' }],
  ['litre', '1 litre stock', { qty: 1, unit: 'L', name: 'stock' }],
  ['unit then "of"', '2 cups of water', { qty: 2, unit: 'cup', name: 'water' }],
  ['bullet prefix', '- 1 cup sugar', { qty: 1, unit: 'cup', name: 'sugar' }],
  [
    'quantity-only word "tomatoes" is not a range',
    '2 tomatoes',
    { qty: 2, unit: null, name: 'tomatoes' },
  ],
  ['header', 'For the sauce:', { qty: null, unit: null, name: 'For the sauce:', unparsed: true }],
  ['symbols only', '*** ???', { qty: null, unit: null, name: '*** ???', unparsed: true }],
  ['empty', '', { qty: null, unit: null, name: '', unparsed: true }],
  ['whitespace only', '   ', { qty: null, unit: null, name: '', unparsed: true }],
  ['quantity only', '2 cups', { qty: 2, unit: 'cup', name: '', unparsed: true }],
];

describe('parseIngredientLine', () => {
  it('has at least 25 cases', () => expect(cases.length).toBeGreaterThanOrEqual(25));

  it.each(cases)('%s: %j', (_label, line, exp) => {
    const got = parseIngredientLine(line);
    if (exp.unparsed) {
      expect(got.unparsed).toBe(true);
      expect(got.raw_text).toBe(line);
      expect(got.qty).toBeNull();
      expect(got.name).toBe(line.trim());
      return;
    }
    expect(got.unparsed).toBeUndefined();
    expect(got.raw_text).toBe(line);
    if (exp.qty === null) expect(got.qty).toBeNull();
    else expect(got.qty).toBeCloseTo(exp.qty, 6);
    expect(got.unit).toBe(exp.unit);
    expect(got.name).toBe(exp.name);
    expect(got.note).toBe(exp.note ?? null);
    expect(got.qtyMax).toBe(exp.qtyMax);
    expect(got.altQty).toBe(exp.altQty);
    expect(got.altUnit).toBe(exp.altUnit);
  });

  it('never throws on odd input', () => {
    for (const l of ['(', ')', '1/0 cup x', '((1 cup))', '1 - ', '⅓', '9'.repeat(400), '\u0000']) {
      expect(() => parseIngredientLine(l)).not.toThrow();
      expect(parseIngredientLine(l).raw_text).toBe(l);
    }
  });
});

describe('toIngredientFields (no conversion)', () => {
  const f = (l: string) => toIngredientFields(parseIngredientLine(l));

  it('US unit fills us_* only', () => {
    expect(f('1 cup flour')).toMatchObject({
      us_qty: 1,
      us_unit: 'cup',
      metric_qty: null,
      metric_unit: null,
      display_primary: 'us',
    });
  });
  it('metric unit fills metric_* only', () => {
    expect(f('115 g butter')).toMatchObject({
      metric_qty: 115,
      metric_unit: 'g',
      us_qty: null,
      us_unit: null,
      display_primary: 'metric',
    });
  });
  it('dual units fill both; primary is the first written', () => {
    expect(f('1 cup (200 g) sugar')).toMatchObject({
      us_qty: 1,
      us_unit: 'cup',
      metric_qty: 200,
      metric_unit: 'g',
      display_primary: 'us',
    });
    expect(f('200 g (1 cup) sugar')).toMatchObject({ display_primary: 'metric', us_qty: 1 });
  });
  it('counts go to metric_qty with null unit', () => {
    expect(f('2 large eggs')).toMatchObject({
      metric_qty: 2,
      metric_unit: null,
      us_qty: null,
      name: 'large eggs',
    });
  });
  it('other units (can) keep their text in metric_unit', () => {
    expect(f('1 (14 oz) can tomatoes')).toMatchObject({ metric_qty: 1, metric_unit: 'can' });
  });
  it('range stores both bounds on the primary side; raw_text keeps the original', () => {
    expect(f('2-3 tbsp honey')).toMatchObject({
      us_qty: 2,
      us_qty_max: 3,
      metric_qty_max: null,
      raw_text: '2-3 tbsp honey',
    });
    expect(f('2 to 3 cloves garlic')).toMatchObject({
      metric_qty: 2,
      metric_qty_max: 3,
      metric_unit: 'cloves',
    });
    expect(f('100-150 g flour')).toMatchObject({ metric_qty: 100, metric_qty_max: 150 });
  });
  it('single quantities and degenerate ranges have no upper bound', () => {
    expect(f('2 tbsp honey')).toMatchObject({ us_qty_max: null, metric_qty_max: null });
    expect(f('3-2 tbsp honey')).toMatchObject({ us_qty: 3, us_qty_max: null });
    expect(f('2-2 tbsp honey')).toMatchObject({ us_qty: 2, us_qty_max: null });
  });
  it('pins degenerate ranges to a single quantity', () => {
    expect(f('3-2 tbsp honey')).toMatchObject({ us_qty: 3, us_qty_max: null });
    expect(f('1-1 g salt')).toMatchObject({ metric_qty: 1, metric_qty_max: null });
  });
  it('a range with a dual unit keeps the upper bound on the primary side only', () => {
    expect(f('2-3 cups (480 mL) stock')).toMatchObject({
      us_qty: 2,
      us_qty_max: 3,
      metric_qty: 480,
      metric_qty_max: null,
    });
  });
  it('no quantity and unparsed lines leave every measure null but keep raw_text', () => {
    expect(f('salt to taste')).toMatchObject({ metric_qty: null, us_qty: null, note: 'to taste' });
    expect(f('For the sauce:')).toMatchObject({
      name: 'For the sauce:',
      raw_text: 'For the sauce:',
      metric_qty: null,
      us_qty: null,
    });
  });
});
