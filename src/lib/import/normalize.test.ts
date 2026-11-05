import { describe, expect, it } from 'vitest';
import { recipeInputSchema } from '@/lib/recipes/schemas';
import { normalizeRecipe } from './normalize';

const base = {
  '@type': 'Recipe',
  name: 'Lemon Cake',
  recipeIngredient: ['200 g flour', '2 eggs'],
  recipeInstructions: ['Mix everything well.', 'Bake until golden.'],
};
const run = (
  extra: Record<string, unknown> = {},
  sourceUrl: string | null = 'https://www.example.com/cake',
) => normalizeRecipe({ ...base, ...extra }, { sourceUrl });
const draftOf = (extra: Record<string, unknown> = {}, sourceUrl?: string | null) => {
  const r = run(extra, sourceUrl);
  if (!r.draft) throw new Error('no draft: ' + r.warnings.join(','));
  return r.draft;
};
const steps = (extra: Record<string, unknown>) => draftOf(extra).sections[0]!.steps;

describe('basic mapping', () => {
  it('produces a valid list-view private draft with one section', () => {
    const d = draftOf();
    expect(recipeInputSchema.safeParse(d).success).toBe(true);
    expect(d.view_mode).toBe('list');
    expect(d.visibility).toBe('private');
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0]!.title).toBeNull();
    expect(d.title).toBe('Lemon Cake');
    expect(d.sections[0]!.ingredients.map((i) => i.name)).toEqual(['flour', 'eggs']);
    expect(d.sections[0]!.ingredients[0]).toMatchObject({
      metric_qty: 200,
      metric_unit: 'g',
      raw_text: '200 g flour',
    });
  });

  it('steps are column steps with null spans and short labels', () => {
    const s = steps({ recipeInstructions: ['Preheat the oven to 180C and grease a tin.'] });
    expect(s[0]).toMatchObject({
      kind: 'column',
      row_start: null,
      row_end: null,
      label: 'Preheat the oven',
    });
    expect(s[0]!.detail).toBe('Preheat the oven to 180C and grease a tin.');
  });

  it('caps step labels at 24 chars', () => {
    const s = steps({ recipeInstructions: ['Supercalifragilisticexpialidocious wonderful thing'] });
    expect(s[0]!.label.length).toBeLessThanOrEqual(24);
  });

  it('uses headline when name is missing', () => {
    expect(draftOf({ name: undefined, headline: 'Head' }).title).toBe('Head');
  });
});

describe('no_recipe cases return null, never a partial draft', () => {
  it.each([
    ['no title', { name: '' }],
    ['no ingredients', { recipeIngredient: [] }],
    ['ingredients missing', { recipeIngredient: undefined }],
    ['blank ingredients', { recipeIngredient: ['  ', ''] }],
    ['no steps', { recipeInstructions: [] }],
    ['steps missing', { recipeInstructions: undefined }],
    ['steps only html noise', { recipeInstructions: ['<br><br>'] }],
  ])('%s', (_n, extra) => {
    expect(run(extra as Record<string, unknown>).draft).toBeNull();
  });
});

describe('recipeInstructions shapes', () => {
  it('string with newlines and numbering', () => {
    const s = steps({ recipeInstructions: '1. Mix flour.\n2) Add eggs.\nStep 3: Bake.' });
    expect(s.map((x) => x.detail)).toEqual(['Mix flour.', 'Add eggs.', 'Bake.']);
  });
  it('string with br tags', () => {
    expect(steps({ recipeInstructions: 'Mix.<br>Bake.<br/>Serve.' }).map((x) => x.detail)).toEqual([
      'Mix.',
      'Bake.',
      'Serve.',
    ]);
  });
  it('HowToStep list (text, falling back to name)', () => {
    const s = steps({
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Whisk eggs.' },
        { '@type': 'HowToStep', name: 'Fold in flour.' },
      ],
    });
    expect(s.map((x) => x.detail)).toEqual(['Whisk eggs.', 'Fold in flour.']);
  });
  it('HowToSection is flattened with the section name as detail prefix', () => {
    const s = steps({
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Frosting',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Beat butter.' },
            { '@type': 'HowToStep', text: 'Add sugar.' },
          ],
        },
        { '@type': 'HowToStep', text: 'Serve.' },
      ],
    });
    expect(s.map((x) => x.detail)).toEqual([
      'Frosting: Beat butter.',
      'Frosting: Add sugar.',
      'Serve.',
    ]);
    expect(s[0]!.label).toBe('Beat butter');
  });
  it('nested arrays of steps', () => {
    expect(steps({ recipeInstructions: [['A one.', 'A two.'], 'B.'] })).toHaveLength(3);
  });
  it('drops empty steps and truncates at 100 with a warning', () => {
    const r = run({
      recipeInstructions: Array.from({ length: 150 }, (_, i) => `Step number ${i}`),
    });
    expect(r.draft!.sections[0]!.steps).toHaveLength(100);
    expect(r.warnings).toContain('steps_truncated');
  });
});

describe('recipeYield', () => {
  it.each([
    [4, 4, null],
    ['6', 6, null],
    ['4 servings', 4, 'servings'],
    ['Makes 12 cookies', 12, 'cookies'],
    [['8', '8 slices'], 8, 'slices'],
    [['Serves 4'], 4, null],
    ['4-6 servings', 4, 'servings'],
    ['2,5 liters', 2.5, 'liters'],
  ])('%j -> %s / %s', (yieldv, servings, label) => {
    const d = draftOf({ recipeYield: yieldv });
    expect(d.servings).toBe(servings);
    expect(d.servings_label ?? null).toBe(label);
  });
  it('unparseable or out of range yield gives null and a warning', () => {
    expect(run({ recipeYield: 'a lot' }).draft!.servings ?? null).toBeNull();
    expect(run({ recipeYield: 'a lot' }).warnings).toContain('yield_unparsed');
    expect(run({ recipeYield: 0 }).draft!.servings ?? null).toBeNull();
    expect(run({ recipeYield: 99999 }).draft!.servings ?? null).toBeNull();
  });
});

describe('times', () => {
  it('maps prep and cook; ignores totalTime when both are present', () => {
    const d = draftOf({ prepTime: 'PT15M', cookTime: 'PT1H30M', totalTime: 'PT9H' });
    expect([d.prep_minutes, d.cook_minutes]).toEqual([15, 90]);
  });
  it('warns on invalid and missing times', () => {
    expect(run({ prepTime: '15 mins' }).warnings).toContain('prepTime_invalid');
    expect(run().warnings).toContain('times_missing');
    expect(run({ prepTime: 'PT5M' }).warnings).not.toContain('times_missing');
  });
});

describe('image variants', () => {
  it.each([
    ['string', 'https://img.example/a.jpg'],
    ['array', ['https://img.example/a.jpg', 'https://img.example/b.jpg']],
    ['ImageObject', { '@type': 'ImageObject', url: 'https://img.example/a.jpg' }],
    ['array of ImageObject', [{ '@type': 'ImageObject', contentUrl: 'https://img.example/a.jpg' }]],
    ['relative', '/a.jpg'],
  ])('%s', (_n, image) => {
    const url = draftOf({ image }, 'https://img.example/r/1').cover_image_url;
    expect(url).toBe('https://img.example/a.jpg');
  });
  it('upgrades http to https and drops unsafe schemes with a warning', () => {
    expect(draftOf({ image: 'http://img.example/a.jpg' }).cover_image_url).toBe(
      'https://img.example/a.jpg',
    );
    const r = run({ image: 'javascript:alert(1)' });
    expect(r.draft!.cover_image_url).toBeNull();
    expect(r.warnings).toContain('image_dropped');
  });
  it('skips an unusable first image and takes the next', () => {
    expect(
      draftOf({ image: ['data:image/png;base64,AAAA', 'https://img.example/ok.jpg'] })
        .cover_image_url,
    ).toBe('https://img.example/ok.jpg');
  });
});

describe('source name, author, tags', () => {
  it('prefers publisher, then hostname without www, then author', () => {
    expect(draftOf({ publisher: { '@type': 'Organization', name: 'Cook Mag' } }).source_name).toBe(
      'Cook Mag',
    );
    expect(draftOf().source_name).toBe('example.com');
    expect(draftOf({ author: { '@type': 'Person', name: 'Ann' } }, null).source_name).toBe('Ann');
    expect(draftOf({}, null).source_name ?? null).toBeNull();
  });
  it('keeps the source url', () => {
    expect(draftOf().source_url).toBe('https://www.example.com/cake');
  });
  it('tags from keywords string, array and recipeCategory; deduped, capped', () => {
    const d = draftOf({ keywords: 'Cake, lemon ,CAKE', recipeCategory: ['Dessert', 'cake'] });
    expect(d.tags).toEqual(['Cake', 'lemon', 'Dessert']);
    const many = draftOf({ keywords: Array.from({ length: 30 }, (_, i) => `t${i}`) });
    expect(many.tags).toHaveLength(10);
    expect(draftOf({ keywords: 'x'.repeat(100) }).tags[0]).toHaveLength(40);
  });
});

describe('ingredients', () => {
  it('splits a single multi-line string and warns about unparsed lines', () => {
    const r = run({ recipeIngredient: '1 cup milk\nFor the sauce:' });
    expect(r.draft!.sections[0]!.ingredients).toHaveLength(2);
    expect(r.warnings.some((w) => w.startsWith('ingredients_unparsed'))).toBe(true);
  });
  it('truncates at 200 with a warning', () => {
    const r = run({
      recipeIngredient: Array.from({ length: 250 }, (_, i) => `${i + 1} g thing${i}`),
    });
    expect(r.draft!.sections[0]!.ingredients).toHaveLength(200);
    expect(r.warnings).toContain('ingredients_truncated');
  });
  it('long unparsed lines still satisfy the schema', () => {
    const d = draftOf({ recipeIngredient: ['y'.repeat(600)] });
    expect(recipeInputSchema.safeParse(d).success).toBe(true);
  });
});

describe('sanitizing across all fields', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(1)>Safe';
  it('no markup survives in any text field', () => {
    const d = draftOf({
      name: evil,
      description: evil,
      recipeYield: `4 ${evil}`,
      recipeIngredient: [`1 cup ${evil}`],
      recipeInstructions: [
        evil,
        { '@type': 'HowToSection', name: evil, itemListElement: [{ text: evil }] },
      ],
      keywords: evil,
      publisher: { name: evil },
      author: evil,
    });
    const flat = JSON.stringify(d);
    expect(flat).not.toMatch(/<script|<img|onerror|alert\(/i);
    expect(d.title).toBe('Safe');
  });
  it('entity-encoded markup is stripped and RTL overrides removed', () => {
    const d = draftOf({ name: '&lt;script&gt;x&lt;/script&gt;Pie' + String.fromCharCode(0x202e) });
    expect(d.title).toBe('Pie');
  });
  it('rejects javascript: as a source url', () => {
    expect(draftOf({}, 'javascript:alert(1)').source_url ?? null).toBeNull();
  });
});

describe('robustness', () => {
  it('does not throw on odd shapes', () => {
    for (const extra of [
      { recipeIngredient: [1, null, {}, ['a']] },
      { recipeInstructions: { text: 'Just one object step.' } },
      { recipeYield: {} },
      { image: 5 },
      { keywords: [1, null, { name: 'ok' }] },
      { author: [{ name: 'A' }, { name: 'B' }] },
    ]) {
      expect(() => run(extra as Record<string, unknown>)).not.toThrow();
    }
  });
});
