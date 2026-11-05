import { describe, expect, it } from 'vitest';
import { validateRecipeGrid } from '@/lib/grid/validate';
import { recipeInputSchema } from '@/lib/recipes/schemas';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import {
  compareStructure,
  deriveMapInput,
  structureOf,
} from '../../../tests/helpers/mapper-structure';
import { mapGrid } from './map-grid';
import { ingredientsFromLines } from './map-sections';
import type { MapInput, MappingProposal, MapStepInput } from './map-types';

// Seeded generator (mulberry32) so fuzz cases are reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function junk(r: () => number, depth = 0): unknown {
  const k = Math.floor(r() * 9);
  switch (k) {
    case 0:
      return null;
    case 1:
      return undefined;
    case 2:
      return Math.floor(r() * 1000) - 500;
    case 3:
      return 'x'.repeat(Math.floor(r() * 50));
    case 4:
      return depth > 2 ? [] : Array.from({ length: Math.floor(r() * 4) }, () => junk(r, depth + 1));
    case 5:
      return depth > 2
        ? {}
        : {
            name: junk(r, depth + 1),
            text: junk(r, depth + 1),
            section: junk(r, depth + 1),
          };
    case 6:
      return true;
    case 7:
      return { name: 'butter', display_primary: 'metric' };
    default:
      return { text: 'Melt the butter.', section: null };
  }
}

describe('mapGrid contract', () => {
  it('returns empty for empty arrays', () => {
    const r = mapGrid({ ingredients: [], steps: [] });
    expect(r).toEqual({ mapped: false, reason: 'empty', warnings: [] });
  });

  it('never throws on wrong types', () => {
    for (const bad of [undefined, null, 5, 'str', [], {}, { ingredients: 1, steps: 'x' }]) {
      expect(() => mapGrid(bad as unknown as MapInput)).not.toThrow();
      expect(mapGrid(bad as unknown as MapInput).mapped).toBe(false);
    }
  });

  it('is total on 200 seeded random shapes', () => {
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const input = { ingredients: junk(r), steps: junk(r) } as unknown as MapInput;
      const out = mapGrid(input);
      expect(typeof out.mapped).toBe('boolean');
    }
  });
});

// -- helpers ----------------------------------------------------------------------------

type StepIn = string | MapStepInput;
function run(lines: string[], steps: StepIn[], opts?: { budget?: number }) {
  const input: MapInput = {
    ingredients: ingredientsFromLines(lines),
    steps: steps.map((st) => (typeof st === 'string' ? { text: st, section: null } : st)),
  };
  return mapGrid(input, opts);
}
function prop(lines: string[], steps: StepIn[]): MappingProposal {
  const r = run(lines, steps);
  if (!r.mapped) throw new Error(`not mapped: ${r.reason}`);
  return r.proposal;
}
/** "T" banner_top, "B" banner_bottom, "a-b" column span. */
const spans = (p: MappingProposal, s = 0): string =>
  p.sections[s]!.steps.map((st) =>
    st.kind === 'column' ? `${st.row_start}-${st.row_end}` : st.kind === 'banner_top' ? 'T' : 'B',
  ).join(' ');
const rows = (p: MappingProposal, s = 0): string[] => p.sections[s]!.ingredients.map((i) => i.name);

describe('reference samples (G1)', () => {
  for (const [name, sample] of [
    ['sample A', SAMPLE_SKILLET_COOKIES],
    ['sample B', SAMPLE_VANILLA_CAKE],
  ] as const) {
    for (const seed of [null, 1, 2, 3, 4]) {
      it(`${name} reproduces the reference structure (shuffle ${seed})`, () => {
        const r = mapGrid(deriveMapInput(sample, seed));
        expect(r.mapped).toBe(true);
        if (!r.mapped) return;
        expect(
          compareStructure(structureOf(r.proposal.sections), structureOf(sample.sections)).exact,
        ).toBe(true);
        expect(r.proposal.confidence).toBe(1);
        expect(r.proposal.level).toBe('high');
      });
    }
  }

  it('sample A: spans 0-0, 0-3, 0-4, 0-8, 0-8 with two top banners and nine rows', () => {
    const r = mapGrid(deriveMapInput(SAMPLE_SKILLET_COOKIES, 2));
    if (!r.mapped) throw new Error('unmapped');
    expect(spans(r.proposal)).toBe('T T 0-0 0-3 0-4 0-8 0-8');
    expect(rows(r.proposal)[0]).toBe('unsalted butter');
    expect(rows(r.proposal)).toHaveLength(9);
  });

  it('sample B: Cake and Frosting, sugar split half/remaining, bottom banner', () => {
    const r = mapGrid(deriveMapInput(SAMPLE_VANILLA_CAKE, 3));
    if (!r.mapped) throw new Error('unmapped');
    expect(r.proposal.sections.map((s) => s.title)).toEqual(['Cake', 'Frosting']);
    expect(spans(r.proposal, 0)).toBe('T 0-1 0-3 0-6 0-7 0-7');
    expect(spans(r.proposal, 1)).toBe('0-1 0-3 B');
    const sugar = r.proposal.sections[0]!.ingredients.filter((i) => i.name === 'sugar');
    expect(sugar.map((i) => i.portion_label)).toEqual(['half', 'remaining']);
    expect(sugar[0]!.split_group_id).toBe(sugar[1]!.split_group_id);
    expect(sugar.map((i) => i.us_qty)).toEqual([0.5, 0.5]);
  });

  it('data-model brownie shape: spans 0-0, 0-3, 0-4, 0-8, 0-8 and two top banners', () => {
    const p = prop(
      [
        '4 oz (115 g) unsalted butter',
        '1 cup (200 g) sugar',
        '1/4 tsp vanilla extract',
        '1 shot espresso',
        '2 large eggs',
        '1/2 cup (65 g) flour',
        '1/4 cup (25 g) cocoa powder',
        '1/2 tsp salt',
        '1 cup chocolate chips',
      ],
      [
        'Butter and flour an 8x8-in pan.',
        'Preheat oven to 350°F (170°C).',
        'Melt the butter over low heat.',
        'Stir in the sugar, vanilla and espresso.',
        'Beat in the eggs.',
        'Fold in the flour, cocoa, salt and chocolate chips.',
        'Bake until a toothpick comes out mostly clean.',
      ],
    );
    expect(spans(p)).toBe('T T 0-0 0-3 0-4 0-8 0-8');
    expect(p.confidence).toBeGreaterThanOrEqual(0.7);
    expect(rows(p)[4]).toBe('large eggs');
  });
});

describe('ordering and spans (G3, G4)', () => {
  const lines = ['2 cups flour', '1 cup sugar', '2 eggs', '1 cup milk'];
  const steps = [
    'Whisk the eggs and sugar.',
    'Stir in the milk.',
    'Fold in the flour.',
    'Bake until golden.',
  ];
  it('orders rows by first mention, independent of input order', () => {
    const a = prop(lines, steps);
    const b = prop([...lines].reverse(), steps);
    expect(rows(a)).toEqual(['eggs', 'sugar', 'milk', 'flour']);
    expect(rows(b)).toEqual(rows(a));
    expect(spans(a)).toBe('0-1 0-2 0-3 0-3');
  });
  it('orders ties by position in the step text', () => {
    const p = prop(['1 cup sugar', '2 eggs'], ['Beat the eggs with the sugar.', 'Bake.']);
    expect(rows(p)).toEqual(['eggs', 'sugar']);
  });
  it('appends unmentioned ingredients and warns', () => {
    const p = prop(['1 cup sugar', '1 tsp salt', '2 eggs'], ['Beat the eggs and sugar.', 'Bake.']);
    expect(rows(p)).toEqual(['eggs', 'sugar', 'salt']);
    expect(p.warnings).toContain('ingredient_unmentioned:salt');
    expect(spans(p)).toBe('0-1 0-2'); // unmentioned rows are covered by the final step only
  });
  it('a step that adds nothing keeps the previous end', () => {
    const p = prop(
      ['1 cup sugar', '2 eggs', '1 cup flour'],
      ['Beat the eggs.', 'Stir for a minute.', 'Add the sugar and flour.', 'Bake.'],
    );
    expect(spans(p)).toBe('0-0 0-0 0-2 0-2');
  });
  it('re-mentioning an earlier ingredient does not move rows', () => {
    const p = prop(['1 cup sugar', '2 eggs'], ['Beat the eggs.', 'Add the sugar and more eggs.']);
    expect(rows(p)).toEqual(['eggs', 'sugar']);
  });
  it('every row is covered and the grid validates', () => {
    const p = prop(lines, steps);
    const v = validateRecipeGrid({ sections: p.sections });
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });
});

describe('name matching in steps', () => {
  it('plural and singular forms', () => {
    const p = prop(
      ['2 eggs', '3 tomatoes', '2 bay leaves'],
      ['Beat the egg.', 'Add the tomato.', 'Add the bay leaf.'],
    );
    expect(rows(p)).toEqual(['eggs', 'tomatoes', 'bay leaves']);
    expect(p.signals.cov).toBe(1);
  });
  it('synonyms', () => {
    const p = prop(
      ['3 scallions', '1 tsp baking soda', '1 cup powdered sugar'],
      [
        'Slice the green onions.',
        'Stir in the bicarbonate of soda.',
        'Dust with confectioners sugar.',
      ],
    );
    expect(p.signals.cov).toBe(1);
  });
  it('coriander seed is not cilantro', () => {
    const p = prop(
      ['1 bunch cilantro', '1 tsp salt'],
      ['Add the coriander seeds.', 'Add the salt.'],
    );
    expect(p.signals.cov).toBe(0.5);
    expect(p.warnings).toContain('ingredient_unmentioned:cilantro');
  });
  it('parentheticals in names and steps are ignored', () => {
    const p = prop(
      ['1 cup butter (2 sticks), softened', '1 cup sugar'],
      ['Cream the butter (see note) with the sugar (superfine works).', 'Bake.'],
    );
    expect(rows(p)).toEqual(['butter', 'sugar']);
    expect(p.signals.cov).toBe(1);
  });
  it('unbalanced parentheses do not break matching', () => {
    const p = prop(['1 cup sugar', '2 eggs'], ['Beat the sugar (see note and the eggs.', 'Bake.']);
    expect(p.signals.cov).toBe(1);
  });
  it('longest phrase wins over the bare noun', () => {
    const p = prop(
      ['1 cup sugar', '1 cup brown sugar'],
      ['Mix the brown sugar.', 'Add the sugar.'],
    );
    expect(rows(p)).toEqual(['brown sugar', 'sugar']);
    expect(p.warnings.some((w) => w.startsWith('ambiguous_name'))).toBe(false);
  });
  it('modifiers in the name are optional in the step', () => {
    const p = prop(
      ['2 large eggs', '4 oz unsalted butter'],
      ['Melt the butter.', 'Beat in the egg.'],
    );
    expect(rows(p)).toEqual(['unsalted butter', 'large eggs']);
  });
});

describe('ambiguity (G7)', () => {
  const lines = ['1 cup brown sugar', '1 cup powdered sugar', '2 eggs'];
  it('does not guess a bare head noun shared by two ingredients', () => {
    const p = prop(lines, ['Beat the eggs with the sugar.', 'Bake.']);
    expect(p.warnings).toContain('ambiguous_name:sugar');
    expect(p.confidence).toBeLessThan(0.7);
    expect(rows(p)[0]).toBe('eggs');
  });
  it('resolves to the only unmentioned candidate (half-ambiguous)', () => {
    const p = prop(lines, ['Beat the eggs with the brown sugar.', 'Add the sugar.', 'Bake.']);
    expect(rows(p)).toEqual(['eggs', 'brown sugar', 'powdered sugar']);
    expect(p.signals.unamb).toBeLessThan(1);
    expect(p.signals.cov).toBe(1);
  });
  it('three oils stay ambiguous', () => {
    const p = prop(
      ['1 tbsp olive oil', '1 tbsp sesame oil', '1 tbsp vegetable oil'],
      ['Heat the oil.', 'Add the oil.'],
    );
    expect(p.confidence).toBeLessThan(0.4);
  });
  it('identical names are not ambiguity', () => {
    const p = prop(
      ['1/2 cup sugar', '2 eggs', '1/2 cup sugar'],
      ['Beat the eggs with the sugar.', 'Fold in the sugar.'],
    );
    expect(p.warnings.some((w) => w.startsWith('ambiguous'))).toBe(false);
    expect(rows(p)).toEqual(['eggs', 'sugar', 'sugar']);
  });
});

describe('banners (G2, G19)', () => {
  const lines = ['1 cup butter', '1 cup flour', '1 cup sugar'];
  it('prep steps that name an ingredient stay banner_top and do not count as mentions', () => {
    const p = prop(lines, [
      'Grease the pan with butter.',
      'Cream the sugar.',
      'Add the butter.',
      'Add the flour.',
      'Bake.',
    ]);
    expect(spans(p)).toBe('T 0-0 0-1 0-2 0-2');
    expect(rows(p)).toEqual(['sugar', 'butter', 'flour']);
  });
  it('"Butter and flour the pan" is a banner and mentions nothing', () => {
    const p = prop(lines, [
      'Butter and flour an 8x8-in pan.',
      'Cream the butter and sugar.',
      'Fold in the flour.',
      'Bake.',
    ]);
    expect(spans(p)).toBe('T 0-1 0-2 0-2');
    expect(rows(p)).toEqual(['butter', 'sugar', 'flour']);
  });
  it('"Butter the bread" is not a banner', () => {
    const p = prop(['4 slices bread', '2 tbsp butter'], ['Butter the bread.', 'Toast in a pan.']);
    expect(spans(p).startsWith('T')).toBe(false);
    expect(rows(p)).toEqual(['butter', 'bread']); // the verb word names the ingredient too
  });
  it('a non-prep step before the first ingredient step is a top banner with a warning', () => {
    const p = prop(
      ['1 cup flour', '1 cup sugar'],
      ['Stir well.', 'Mix the flour and sugar.', 'Bake.'],
    );
    expect(spans(p)).toBe('T 0-1 0-1');
    expect(p.warnings).toContain('step_without_ingredients');
  });
  it('trailing finish steps after the last cook step become bottom banners', () => {
    const p = prop(lines, [
      'Cream the butter and sugar.',
      'Fold in the flour.',
      'Bake 30 minutes.',
      'Let cool completely.',
      'Slice and serve.',
    ]);
    expect(spans(p)).toBe('0-1 0-2 0-2 B B');
  });
  it('the last cook step stays a column', () => {
    const p = prop(lines, ['Mix everything.', 'Bake until set.']);
    expect(spans(p).endsWith('0-2')).toBe(true);
  });
  it('without a cook step, steps after the last adding step become bottom banners', () => {
    const p = prop(
      ['1 cup milk', '1 tbsp sugar'],
      ['Whisk the milk and sugar.', 'Chill for 1 hour.', 'Serve cold.'],
    );
    expect(spans(p)).toBe('0-1 B B');
  });
  it('a rest step in the middle is a column with the previous span', () => {
    const p = prop(
      ['2 cups flour', '1 cup water', '1 tsp salt'],
      ['Knead the flour and water.', 'Rest 10 minutes.', 'Add the salt.', 'Bake.'],
    );
    expect(spans(p)).toBe('0-1 0-1 0-2 0-2');
  });
  it('a serving note naming an ingredient is still a bottom banner', () => {
    const p = prop(
      ['2 cups oats', '1 cup milk', '2 tbsp honey'],
      ['Cook the oats in the milk.', 'Serve with extra honey.'],
    );
    expect(spans(p)).toBe('0-2 B');
    expect(p.warnings).toContain('ingredient_unmentioned:honey');
  });
  it('a section of only banners keeps the last step as a column', () => {
    const p = prop(['1 cup flour'], ['Preheat the oven to 200°C.', 'Grease a pan.']);
    expect(spans(p)).toBe('T 0-0');
  });
  it('the first bottom step becomes a column when nothing else is', () => {
    const p = prop(['1 cup milk'], ['Let cool.', 'Serve.']);
    expect(p.sections[0]!.steps.some((st) => st.kind === 'column')).toBe(true);
  });
});

describe('group references (G5)', () => {
  it('"all the ingredients" spans every row', () => {
    const p = prop(
      ['1 cup flour', '1 cup sugar', '2 eggs'],
      ['Beat the eggs.', 'Combine all the ingredients.', 'Bake.'],
    );
    expect(spans(p)).toBe('0-0 0-2 0-2');
    expect(p.signals.cov).toBe(1);
    expect(p.warnings).not.toContain('group_reference');
  });
  it('"dry ingredients" is an unresolved group reference', () => {
    const p = prop(
      ['1 cup flour', '1 cup sugar', '2 eggs'],
      ['Beat the eggs.', 'Whisk the dry ingredients.', 'Bake.'],
    );
    expect(p.warnings).toContain('group_reference');
    expect(p.signals.groupRefs).toBe(1);
    expect(p.confidence).toBeLessThan(0.7);
  });
  it('the batter and the dough are not ingredients', () => {
    const p = prop(
      ['1 cup flour', '2 eggs'],
      ['Beat the eggs.', 'Stir the batter.', 'Add the flour to the dough.', 'Bake.'],
    );
    expect(p.warnings.filter((w) => w.startsWith('ambiguous'))).toEqual([]);
  });
});

describe('sections (G16, G20)', () => {
  const ing = [
    'For the cake:',
    '1 cup flour',
    '2 eggs',
    'For the frosting:',
    '1 cup powdered sugar',
    '2 tbsp butter',
  ];
  it('heading lines create sections and are removed from the steps', () => {
    const p = prop(ing, [
      'For the cake:',
      'Beat the eggs.',
      'Add the flour.',
      'Bake.',
      'For the frosting:',
      'Beat the butter.',
      'Add the powdered sugar.',
    ]);
    expect(p.sections.map((s) => s.title)).toEqual(['Cake', 'Frosting']);
    expect(p.sections.map((s) => s.steps.length)).toEqual([3, 2]);
    expect(spans(p, 0)).toBe('0-0 0-1 0-1');
    expect(spans(p, 1)).toBe('0-0 0-1');
    expect(p.sections[0]!.ingredients.map((i) => i.group_label)).toEqual([null, null]);
  });
  it('HowToSection hints give the same result', () => {
    const steps = [
      { text: 'Beat the eggs.', section: 'Cake' },
      { text: 'Add the flour.', section: 'Cake' },
      { text: 'Bake.', section: 'Cake' },
      { text: 'Beat the butter.', section: 'Frosting' },
      { text: 'Add the powdered sugar.', section: 'Frosting' },
    ];
    const p = prop(ing, steps);
    expect(p.sections.map((s) => s.title)).toEqual(['Cake', 'Frosting']);
    expect(spans(p, 1)).toBe('0-0 0-1');
  });
  it('each section is mapped independently (final step spans its own rows)', () => {
    const p = prop(ing, [
      'For the cake:',
      'Beat the eggs.',
      'Add the flour.',
      'For the frosting:',
      'Beat the butter.',
      'Add the powdered sugar.',
    ]);
    expect(spans(p, 0)).toBe('0-0 0-1');
    expect(spans(p, 1)).toBe('0-0 0-1');
  });
  it('ingredient groups with flat steps become one section with a warning and lower confidence', () => {
    const p = prop(ing, [
      'Beat the eggs.',
      'Add the flour.',
      'Beat the butter.',
      'Add the powdered sugar.',
      'Bake.',
    ]);
    expect(p.sections).toHaveLength(1);
    expect(p.warnings).toContain('sections_from_ingredients_only');
    expect(p.signals.secFactor).toBe(0.85);
    expect(p.sections[0]!.ingredients.map((i) => i.group_label)).toContain('Frosting');
  });
  it('a flat list shared by two sections warns and assigns the first mentioning section', () => {
    const p = prop(
      ['2 tbsp butter', '1 cup flour', '1 cup sugar'],
      [
        'For the cake:',
        'Cream the butter and sugar.',
        'Add the flour.',
        'For the glaze:',
        'Melt the butter.',
        'Add the sugar.',
      ],
    );
    expect(p.warnings).toContain('ingredient_shared_across_sections');
    expect(p.sections.map((s) => s.ingredients.length)).toEqual(
      [3, 0].map((x, i) => (i === 0 ? 3 : x)).slice(0, p.sections.length),
    );
  });
  it('a section without ingredients merges into its predecessor', () => {
    const p = prop(
      ['1 cup flour', '2 eggs'],
      [
        'For the cake:',
        'Beat the eggs.',
        'Add the flour.',
        'For the garnish:',
        'Sprinkle with parsley.',
      ],
    );
    expect(p.sections).toHaveLength(1);
    expect(p.warnings).toContain('section_merged');
    expect(p.signals.secFactor).toBe(0.7);
  });
  it('seven sections give no proposal', () => {
    const steps: StepIn[] = [];
    for (let i = 0; i < 7; i++) steps.push(`For the part ${'abcdefg'[i]}:`, 'Stir the flour.');
    const r = run(['1 cup flour'], steps);
    expect(r).toMatchObject({ mapped: false, reason: 'too_many_sections' });
  });
  it('"For the best results, chill overnight." stays a step', () => {
    const p = prop(['1 cup flour'], ['Stir the flour.', 'For the best results, chill overnight.']);
    expect(p.sections[0]!.steps).toHaveLength(2);
  });
});

describe('splits (G8)', () => {
  it('half then remaining makes two rows with one group', () => {
    const p = prop(
      ['1 cup sugar', '1 cup butter', '2 eggs'],
      [
        'Cream the butter with half of the sugar.',
        'Beat in the eggs.',
        'Fold in the remaining sugar.',
        'Bake.',
      ],
    );
    expect(rows(p)).toEqual(['butter', 'sugar', 'eggs', 'sugar']);
    expect(p.sections[0]!.ingredients.map((i) => i.portion_label)).toEqual([
      null,
      'half',
      null,
      'remaining',
    ]);
    expect(spans(p)).toBe('0-1 0-2 0-3 0-3');
    expect(p.signals.splitOk).toBe(1);
  });
  it('"divided" note with explicit quantities in two steps', () => {
    const p = prop(
      ['4 tbsp sugar, divided', '1 cup butter'],
      ['Cream the butter with 2 tbsp of the sugar.', 'Fold in 2 tbsp of the sugar.', 'Bake.'],
    );
    expect(p.sections[0]!.ingredients.map((i) => i.portion_label)).toEqual([
      null,
      '2 tbsp',
      '2 tbsp',
    ]);
  });
  it('unresolvable partial mentions keep one row and warn', () => {
    const p = prop(
      ['1 cup sugar', '1 cup butter'],
      [
        'Cream the butter with some of the sugar.',
        'Add half the sugar.',
        'Fold in the sugar.',
        'Bake.',
      ],
    );
    expect(rows(p).filter((r) => r === 'sugar')).toHaveLength(1);
    expect(p.warnings).toContain('split_unresolved:sugar');
    expect(p.signals.splitOk).toBe(0);
    expect(p.confidence).toBeLessThan(1);
  });
  it('split group ids are unique per ingredient and never cross sections', () => {
    const p = prop(
      ['For the a:', '1 cup sugar', '1 cup butter', 'For the b:', '2 cup sugar', '1 cup flour'],
      [
        'For the a:',
        'Cream the butter with half the sugar.',
        'Add the remaining sugar.',
        'For the b:',
        'Mix the flour with half the sugar.',
        'Add the remaining sugar.',
      ],
    );
    const ids = p.sections.flatMap((s) =>
      s.ingredients.map((i) => i.split_group_id).filter(Boolean),
    );
    expect(new Set(ids).size).toBe(2);
    expect(validateRecipeGrid({ sections: p.sections }).errors).toEqual([]);
  });
  it('repeated plain mentions are not splits', () => {
    const p = prop(
      ['1 cup sugar', '1 cup butter'],
      ['Cream the butter and sugar.', 'Add the sugar.', 'Bake.'],
    );
    expect(rows(p)).toEqual(['butter', 'sugar']);
    expect(p.signals.splitOk).toBe(1);
  });
});

describe('degenerate recipes', () => {
  it('a single step is capped at 0.50', () => {
    const p = prop(['1 cup flour', '2 eggs'], ['Mix the flour and the eggs and bake.']);
    expect(p.confidence).toBeLessThanOrEqual(0.5);
  });
  it('every step spanning everything is capped at 0.55', () => {
    const p = prop(
      ['1 cup flour', '2 eggs'],
      ['Dump the flour and eggs in a bowl.', 'Stir.', 'Bake.'],
    );
    expect(p.confidence).toBeLessThanOrEqual(0.55);
  });
  it('steps that mention nothing give a low-confidence proposal', () => {
    const p = prop(['1 cup flour', '2 eggs'], ['Combine well.', 'Wait a bit.', 'Enjoy.']);
    expect(p.confidence).toBeLessThan(0.4);
    expect(p.level).toBe('low');
  });
  it('steps without recognized verbs fall back to the first words as label', () => {
    const p = prop(
      ['2 tbsp butter', '1 cup sugar', '2 eggs'],
      ['Butter, sugar and eggs in a bowl.', 'The oven at 180 degrees.'],
    );
    expect(p.sections[0]!.steps[0]!.label.length).toBeGreaterThan(0);
    expect(p.signals.verbs).toBeLessThan(1);
  });
  it('non-English steps map to low confidence without failing', () => {
    const p = prop(
      ['200 g bloem', '2 eieren'],
      ['Meng de bloem en de eieren.', 'Bak 30 minuten in de oven.'],
    );
    expect(p.level).toBe('low');
  });
});

describe('step fields', () => {
  it('keeps detail verbatim, in input order', () => {
    const steps = ['Beat the eggs.  ', 'Fold in the flour & sugar <b>now</b>.', 'Bake.'];
    const p = prop(['1 cup flour', '2 eggs', '1 cup sugar'], steps);
    expect(p.sections[0]!.steps.map((st) => st.detail)).toEqual(steps.map((x) => x.trim()));
  });
  it('extracts temperature and duration', () => {
    const p = prop(
      ['1 cup flour', '2 eggs'],
      ['Beat the eggs and flour.', 'Bake at 350°F (170°C) for 30-40 minutes.'],
    );
    expect(p.sections[0]!.steps[1]).toMatchObject({
      temp_f: 350,
      temp_c: 170,
      minutes_min: 30,
      minutes_max: 40,
    });
  });
  it('labels come from the controlled verb list', () => {
    const p = prop(['1 cup flour', '2 eggs'], ['Whisk the eggs.', 'Fold in the flour.', 'Bake.']);
    expect(p.sections[0]!.steps.map((st) => st.label)).toEqual(['whisk', 'fold in', 'bake']);
  });
  it('output passes the recipe schema and grid validation', () => {
    const r = mapGrid(deriveMapInput(SAMPLE_VANILLA_CAKE, 5));
    if (!r.mapped) throw new Error('unmapped');
    expect(recipeInputSchema.safeParse({ title: 'x', sections: r.proposal.sections }).success).toBe(
      true,
    );
    expect(validateRecipeGrid({ sections: r.proposal.sections }).errors).toEqual([]);
  });
});

describe('totality, determinism and budget', () => {
  it('is deterministic', () => {
    const a = mapGrid(deriveMapInput(SAMPLE_VANILLA_CAKE, 9));
    const b = mapGrid(deriveMapInput(SAMPLE_VANILLA_CAKE, 9));
    expect(a).toEqual(b);
  });
  it('does not mutate its input', () => {
    const input = deriveMapInput(SAMPLE_SKILLET_COOKIES, 1);
    const copy = JSON.parse(JSON.stringify(input));
    mapGrid(input);
    expect(input).toEqual(copy);
  });
  it('returns budget when the operation budget is exhausted', () => {
    const r = mapGrid(deriveMapInput(SAMPLE_SKILLET_COOKIES, 1), { budget: 10 });
    expect(r).toEqual({ mapped: false, reason: 'budget', warnings: ['mapping_budget'] });
  });
  it('ignores a non-positive budget option', () => {
    expect(mapGrid(deriveMapInput(SAMPLE_SKILLET_COOKIES, 1), { budget: -5 }).mapped).toBe(true);
  });
});

// -- property tests -----------------------------------------------------------------------

const POOL = [
  '2 cups flour',
  '1 cup sugar',
  '3 eggs',
  '1 cup milk',
  '4 tbsp butter',
  '1 tsp vanilla extract',
  '1/2 tsp salt',
  '1 tsp baking powder',
  '1 cup chocolate chips',
  '2 tbsp honey',
  '1 cup walnuts',
  '2 carrots',
];
const NOUN = [
  'flour',
  'sugar',
  'eggs',
  'milk',
  'butter',
  'vanilla',
  'salt',
  'baking powder',
  'chocolate chips',
  'honey',
  'walnuts',
  'carrots',
];
const VERB = ['Mix', 'Stir in', 'Beat', 'Fold in', 'Whisk', 'Add'];

function genRecipe(r: () => number) {
  const k = 3 + Math.floor(r() * 8);
  const idx = [...POOL.keys()].sort(() => r() - 0.5).slice(0, k);
  const lines = idx.map((i) => POOL[i]!);
  const steps: string[] = [];
  if (r() < 0.5) steps.push('Preheat the oven to 180°C.');
  const covered = [...idx].sort(() => r() - 0.5);
  while (covered.length) {
    const take = covered.splice(0, 1 + Math.floor(r() * 3));
    steps.push(
      `${VERB[Math.floor(r() * VERB.length)]!} the ${take.map((i) => NOUN[i]!).join(' and the ')}.`,
    );
  }
  steps.push('Bake until golden.');
  if (r() < 0.5) steps.push('Let cool, then serve.');
  return { lines, steps };
}

describe('property tests (seeded, 300 cases)', () => {
  it('holds the structural invariants', () => {
    const r = rng(2024);
    for (let n = 0; n < 300; n++) {
      const { lines, steps } = genRecipe(r);
      const input: MapInput = {
        ingredients: ingredientsFromLines(lines),
        steps: steps.map((text) => ({ text, section: null })),
      };
      const res = mapGrid(input);
      expect(res.mapped).toBe(true);
      if (!res.mapped) continue;
      const sec = res.proposal.sections[0]!;
      // ingredient count preserved (no splits in this generator)
      expect(sec.ingredients).toHaveLength(lines.length);
      // details verbatim, in input order
      expect(sec.steps.map((st) => st.detail)).toEqual(steps);
      // grid is valid, every row covered
      const v = validateRecipeGrid({ sections: res.proposal.sections });
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
      // deterministic
      expect(mapGrid(input)).toEqual(res);
      // spans are cumulative and never shrink
      const ends = sec.steps.filter((st) => st.kind === 'column').map((st) => st.row_end as number);
      expect([...ends].sort((a, b) => a - b)).toEqual(ends);
      expect(ends[ends.length - 1]).toBe(lines.length - 1);
      // confidence is in range
      expect(res.proposal.confidence).toBeGreaterThanOrEqual(0);
      expect(res.proposal.confidence).toBeLessThanOrEqual(1);
      // idempotent on structure when fed its own output
      const again = mapGrid({
        ingredients: sec.ingredients,
        steps: sec.steps.map((st) => ({ text: st.detail, section: null })),
      });
      expect(again.mapped).toBe(true);
      if (again.mapped) {
        expect(structureOf(again.proposal.sections)).toEqual(structureOf(res.proposal.sections));
      }
    }
  });

  it('never throws on fuzzed text', () => {
    const r = rng(99);
    const alphabet = [
      '(',
      ')',
      ' ',
      '1',
      '/',
      '2',
      'a',
      'sugar',
      'half',
      'the',
      ',',
      '.',
      '\n',
      'For the',
      ':',
      'é',
      '\u200b',
    ];
    for (let n = 0; n < 200; n++) {
      const text = () =>
        Array.from(
          { length: Math.floor(r() * 60) },
          () => alphabet[Math.floor(r() * alphabet.length)],
        ).join('');
      const res = mapGrid({
        ingredients: Array.from({ length: 1 + Math.floor(r() * 5) }, () => ({
          ...ingredientsFromLines(['1 cup sugar'])[0]!,
          name: text() || 'x',
        })),
        steps: Array.from({ length: 1 + Math.floor(r() * 6) }, () => ({
          text: text() || 'x',
          section: r() < 0.2 ? text() : null,
        })),
      });
      expect(typeof res.mapped).toBe('boolean');
    }
  });
});
