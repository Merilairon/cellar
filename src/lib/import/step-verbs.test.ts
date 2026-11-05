import { describe, expect, it } from 'vitest';
import {
  classifyStep,
  extractDurations,
  extractTemperature,
  fallbackLabel,
  PHRASAL_VERBS,
  VERBS,
  VERB_CLASS,
} from './step-verbs';

describe('verb picking', () => {
  const rows: Array<[string, string | null, string]> = [
    ['Melt the butter in a small pan over low heat', 'melt', 'cook'],
    ['Then fold in the flour', 'fold in', 'combine'],
    ['In a large bowl, whisk the eggs', 'whisk', 'combine'],
    ['Once cool, spread the frosting', 'spread', 'finish'],
    ['Once the cake is completely cool, spread the frosting on top.', 'spread', 'finish'],
    ['Stir the sugar, vanilla and espresso into the warm butter until smooth.', 'stir', 'combine'],
    ['Whisk in the eggs one at a time until glossy.', 'whisk in', 'combine'],
    ['Bake until the edges are set.', 'bake', 'cook'],
    ['Cream the butter and sugar.', 'cream', 'combine'],
    ['Add the heavy cream and stir.', 'add', 'combine'],
    ['Pour over the sauce.', 'pour over', 'combine'],
    ['Cut in the butter until crumbly.', 'cut in', 'combine'],
    ['Let cool completely.', 'cool', 'finish'],
    ['Allow to rest for 10 minutes.', 'rest', 'finish'],
    ['Serve warm.', 'serve', 'finish'],
    ['Brown the onions until golden.', 'brown', 'cook'],
    ['Add the light brown sugar.', 'add', 'combine'],
    ['Bring to a boil, then simmer.', 'bring', 'cook'],
    ['Saute the garlic.', 'saute', 'cook'],
    ['The oven at 180.', null, 'x'],
    ['Butter, sugar and eggs in a bowl.', null, 'x'],
    ['', null, 'x'],
  ];
  it.each(rows)('%j -> %s', (text, verb, cls) => {
    const c = classifyStep(text);
    expect(c.verb).toBe(verb);
    if (verb) expect(c.class).toBe(cls);
  });

  it('falls back to a short label without a verb', () => {
    const c = classifyStep('The oven at 180 degrees for the whole time');
    expect(c.verb).toBeNull();
    expect(c.label).toBe('The oven at');
    expect(c.label.length).toBeLessThanOrEqual(24);
  });

  it('keeps labels within 24 characters', () => {
    expect(fallbackLabel('Supercalifragilisticexpialidocious wonderful day')).toHaveLength(24);
    expect(fallbackLabel('...')).toBe('step');
    expect(fallbackLabel('!! Hello there world')).toBe('Hello there world');
    for (const v of VERBS) expect(v.length).toBeLessThanOrEqual(24);
    for (const p of PHRASAL_VERBS) expect(p.length).toBeLessThanOrEqual(24);
  });

  it('classifies every listed verb', () => {
    expect(VERB_CLASS.get('melt')).toBe('cook');
    expect(VERB_CLASS.get('whisk')).toBe('combine');
    expect(VERB_CLASS.get('chill')).toBe('finish');
    expect(VERB_CLASS.get('preheat')).toBe('prep');
  });

  it('flags cook and combine verbs anywhere in the step', () => {
    const c = classifyStep('Pour into the pan and bake for 30 minutes.');
    expect(c.hasCook).toBe(true);
    expect(c.hasCombine).toBe(true);
    const f = classifyStep('Let cool, then slice and serve.');
    expect(f.hasCook).toBe(false);
    expect(f.leadFinish).toBe(true);
  });

  it('marks serving verbs', () => {
    expect(classifyStep('Serve with extra honey.').leadServe).toBe(true);
    expect(classifyStep('Spread the frosting.').leadServe).toBe(false);
  });
});

describe('prep detection (G2)', () => {
  const prep = [
    'Grease a 10 inch oven-safe skillet with a little butter.',
    'Heat the oven to 350°F (170°C).',
    'Butter and flour an 8x8-in pan.',
    'Line a 9 inch round pan.',
    'Preheat oven to 350°F (170°C).',
    'Lightly oil a baking sheet.',
    'Heat the oven to 350°F (170°C) and line a 9 inch round pan.',
    'Set aside.',
    'Preheat the grill.',
    'Gather your ingredients.',
  ];
  it.each(prep)('prep: %s', (t) => expect(classifyStep(t).isPrep).toBe(true));
  const notPrep = [
    'Butter the bread slices.',
    'Flour the work surface while kneading.',
    'Heat the oil in a pan.',
    'Melt the butter in a small pan.',
    'Butter the bread and place on a baking sheet to toast.',
    'Stir well.',
  ];
  it.each(notPrep)('not prep: %s', (t) => expect(classifyStep(t).isPrep).toBe(false));

  it('labels prep steps with the prep verb', () => {
    expect(classifyStep('Grease a 10 inch oven-safe skillet with a little butter.').label).toBe(
      'grease',
    );
    expect(classifyStep('Lightly oil a baking sheet.').label).toBe('oil');
    expect(classifyStep('Heat the oven to 350°F (170°C).').label).toBe('heat');
  });
});

describe('group references (G5)', () => {
  const rows: Array<[string, string | null]> = [
    ['Combine all the ingredients in a bowl.', 'all'],
    ['Mix everything together.', 'all'],
    ['Add the remaining ingredients.', 'all'],
    ['Whisk the dry ingredients.', 'dry'],
    ['Whisk the wet ingredients.', 'wet'],
    ['Stir in the rest.', 'all'],
    ['Stir in the rest of the sugar.', null],
    ['Fold the batter gently.', null],
  ];
  it.each(rows)('%j -> %s', (t, ref) => expect(classifyStep(t).hasGroupRef).toBe(ref));
});

describe('temperature (G17)', () => {
  const rows: Array<[string, { c?: number; f?: number }]> = [
    ['Heat the oven to 350°F (170°C).', { f: 350, c: 170 }],
    ['Bake at 350 F.', { f: 350 }],
    ['Bake at 180°C.', { c: 180 }],
    ['Bake at 180 C for a while.', { c: 180 }],
    ['Bake at 350 degrees F.', { f: 350 }],
    ['Bake at 180 degrees Celsius.', { c: 180 }],
    ['Add 1 c sugar.', {}],
    ['Use an 8x8-in pan.', {}],
    ['Add 2 cups flour.', {}],
    ['Cook 350 g pasta.', {}],
    ['Set to 3.5°F.', {}],
    ['', {}],
  ];
  it.each(rows)('%j', (t, exp) => expect(extractTemperature(t)).toEqual(exp));
});

describe('duration (G17)', () => {
  const rows: Array<[string, Array<[number, number]>]> = [
    ['Bake 30-40 minutes.', [[30, 40]]],
    ['Bake 30 to 40 min.', [[30, 40]]],
    ['Bake 30–40 minutes.', [[30, 40]]],
    ['Rest 1 hour.', [[60, 60]]],
    ['Rest 1 hour 15 minutes.', [[75, 75]]],
    ['Rest 1 hr and 15 mins.', [[75, 75]]],
    ['Rest 1-2 hours.', [[60, 120]]],
    ['Rest 1.5 hours.', [[90, 90]]],
    ['Rest overnight.', []],
    ['Add 1/2 hour of patience.', []],
    ['Use a 10-inch pan.', []],
    [
      'Bake 10 min, then 5 min.',
      [
        [10, 10],
        [5, 5],
      ],
    ],
  ];
  it.each(rows)('%j', (t, exp) =>
    expect(extractDurations(t).map((d) => [d.min, d.max])).toEqual(exp),
  );

  it('uses the first duration and warns when there are two distinct', () => {
    const c = classifyStep('Bake 10 min, then 5 min.');
    expect(c.minutes).toEqual({ min: 10, max: 10 });
    expect(c.warnings).toEqual(['time_ambiguous']);
    expect(classifyStep('Bake 10 minutes. Wait, 10 minutes.').warnings).toEqual([]);
  });

  it('feeds classifyStep', () => {
    const c = classifyStep('Bake at 350°F (170°C) for 30-40 minutes.');
    expect(c.temp).toEqual({ f: 350, c: 170 });
    expect(c.minutes).toEqual({ min: 30, max: 40 });
  });
});
