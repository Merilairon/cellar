import { describe, expect, it } from 'vitest';
import {
  assignIngredients,
  groupSteps,
  ingredientHeadingTitle,
  ingredientsFromLines,
  isIngredientHeading,
  isStepHeading,
  stepHeadingTitle,
  titleKey,
} from './map-sections';

describe('step headings', () => {
  const yes: Array<[string, string]> = [
    ['For the frosting:', 'Frosting'],
    ['For the Cake', 'Cake'],
    ['To make the sauce:', 'Sauce'],
    ['Make the filling', 'Filling'],
    ['Prepare the crust', 'Crust'],
    ['Sauce:', 'Sauce'],
    ['Frosting Instructions', 'Frosting'],
    ['For the cream cheese frosting', 'Cream cheese frosting'],
  ];
  it.each(yes)('heading %j', (line, title) => expect(stepHeadingTitle(line)).toBe(title));

  const no = [
    'For the best results, chill overnight.',
    'For the best results chill overnight',
    'Stir well:',
    'Stir well',
    'Mix the batter until smooth.',
    'x'.repeat(61),
    'Make the sauce while the pasta cooks, then drain it.',
    'Sauce.',
    '',
    'For the 4 people',
    'Instructions',
  ];
  it.each(no)('not a heading %j', (line) => expect(isStepHeading(line)).toBe(false));

  it('bare word is a heading only when it matches a known title', () => {
    expect(isStepHeading('Frosting')).toBe(false);
    expect(isStepHeading('Frosting', new Set([titleKey('Frosting')]))).toBe(true);
  });
});

describe('ingredient headings', () => {
  const yes = ['For the frosting:', 'Sauce:', 'For the Cake', 'Topping:'];
  it.each(yes)('heading %j', (l) => expect(isIngredientHeading(l)).toBe(true));
  const no = [
    '1 tsp salt',
    'Salt',
    'Frosting',
    'a pinch of salt',
    '2 eggs:',
    'butter, softened',
    '',
  ];
  it.each(no)('not a heading %j', (l) => expect(isIngredientHeading(l)).toBe(false));
  it('bare word with a known step title is a heading', () => {
    expect(ingredientHeadingTitle('Frosting', new Set([titleKey('For the frosting')]))).toBe(
      'Frosting',
    );
    expect(ingredientHeadingTitle('Salt', new Set([titleKey('For the frosting')]))).toBeNull();
  });
});

describe('ingredientsFromLines', () => {
  it('records group_label on following lines and removes headings', () => {
    const out = ingredientsFromLines([
      '1 cup flour',
      'For the frosting:',
      '2 tbsp butter',
      '1 cup powdered sugar',
    ]);
    expect(out.map((i) => [i.name, i.group_label])).toEqual([
      ['flour', null],
      ['butter', 'Frosting'],
      ['powdered sugar', 'Frosting'],
    ]);
  });
  it('caps the list', () => {
    expect(
      ingredientsFromLines(Array.from({ length: 500 }, (_, i) => `${i + 1} g salt`)),
    ).toHaveLength(200);
  });
});

describe('groupSteps', () => {
  it('turns heading lines into groups and removes them', () => {
    const g = groupSteps([
      { text: 'Mix.', section: null },
      { text: 'For the frosting:', section: null },
      { text: 'Beat.', section: null },
    ]);
    expect(g).toEqual([
      { title: null, steps: ['Mix.'] },
      { title: 'Frosting', steps: ['Beat.'] },
    ]);
  });
  it('HowToSection hints give the same section list as heading lines', () => {
    const hinted = groupSteps([
      { text: 'Mix.', section: 'Cake' },
      { text: 'Bake.', section: 'Cake' },
      { text: 'Beat.', section: 'Frosting' },
    ]);
    const lines = groupSteps([
      { text: 'For the cake:', section: null },
      { text: 'Mix.', section: null },
      { text: 'Bake.', section: null },
      { text: 'For the frosting:', section: null },
      { text: 'Beat.', section: null },
    ]);
    expect(hinted).toEqual(lines);
  });
  it('drops empty groups and keeps a plain list as one group', () => {
    expect(
      groupSteps([
        { text: 'For the a:', section: null },
        { text: 'For the b:', section: null },
      ]),
    ).toEqual([]);
    expect(
      groupSteps([
        { text: 'Mix.', section: null },
        { text: 'Bake.', section: null },
      ]),
    ).toHaveLength(1);
  });
  it('a non-heading sentence starting with For the stays a step', () => {
    const g = groupSteps([{ text: 'For the best results, chill overnight.', section: null }]);
    expect(g).toEqual([{ title: null, steps: ['For the best results, chill overnight.'] }]);
  });
});

describe('assignIngredients', () => {
  const groups = [
    { title: 'Cake', steps: ['a'] },
    { title: 'Frosting', steps: ['b'] },
  ];
  it('assigns by label, ignoring prefixes and case', () => {
    const r = assignIngredients(groups, [
      { group_label: 'Cake' },
      { group_label: 'For the frosting' },
      { group_label: 'FROSTING' },
    ]);
    expect(r.sections.map((s) => s.ingredients)).toEqual([[0], [1, 2]]);
    expect(r.warnings).toEqual([]);
  });
  it('falls back to mentions and warns when shared', () => {
    const m = [new Set([0, 1]), new Set([1, 2])];
    const r = assignIngredients(groups, [{}, {}, {}], (g) => m[g]!);
    expect(r.sections.map((s) => s.ingredients)).toEqual([[0, 1], [2]]);
    expect(r.warnings).toContain('ingredient_shared_across_sections');
  });
  it('merges a section without ingredients into its predecessor', () => {
    const r = assignIngredients(groups, [{ group_label: 'Cake' }]);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.steps).toEqual(['a', 'b']);
    expect(r.warnings).toContain('section_merged');
  });
  it('merges a leading empty section into the next one', () => {
    const r = assignIngredients(groups, [{ group_label: 'Frosting' }]);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.steps).toEqual(['a', 'b']);
    expect(r.sections[0]!.title).toBe('Frosting');
  });
  it('one section from ingredient groups only', () => {
    const r = assignIngredients([{ title: null, steps: ['x'] }], [{ group_label: 'Sauce' }, {}]);
    expect(r.sections).toHaveLength(1);
    expect(r.warnings).toEqual(['sections_from_ingredients_only']);
  });
  it('reports more than 6 sections', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ title: `S${i}`, steps: ['x'] }));
    expect(assignIngredients(many, [{}]).tooMany).toBe(true);
  });
  it('titleKey drops prefixes and plurals', () => {
    expect(titleKey('For the Frostings')).toBe('frosting');
    expect(titleKey('To make the sauce:')).toBe('sauce');
    expect(titleKey('Sauce Instructions')).toBe('sauce');
  });
});
