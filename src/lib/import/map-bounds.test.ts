import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapGrid } from './map-grid';
import { MAPPER_PATTERNS } from './map-patterns';
import { MAP_LIMITS, type MapInput } from './map-types';
// Importing the modules registers their patterns.
import './ingredient-match';
import './map-confidence';
import './map-sections';
import './map-split';
import './step-verbs';
import './text-tokens';
import type { IngredientInput } from '@/lib/recipes/schemas';

// Security checkpoint for weekend 1 (tasklist T9, G10, Security note): the mapper consumes
// attacker-controlled text, so every pattern, every input cap and the operation budget is
// exercised here. Wall-clock limits are regression tripwires; the guard is the budget.

const MAPPER_FILES = [
  'ingredient-match',
  'map-confidence',
  'map-grid',
  'map-patterns',
  'map-sections',
  'map-split',
  'map-types',
  'step-verbs',
  'text-tokens',
].map((n) => `src/lib/import/${n}.ts`);

const ing = (name: string, extra: Partial<IngredientInput> = {}): IngredientInput => ({
  name,
  note: null,
  raw_text: null,
  metric_qty: null,
  metric_qty_max: null,
  metric_unit: null,
  us_qty: null,
  us_qty_max: null,
  us_unit: null,
  display_primary: 'metric',
  split_group_id: null,
  portion_label: null,
  group_label: null,
  ...extra,
});

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

describe('pattern registry', () => {
  const N = 4000;
  const adversarial: Record<string, string> = {
    'a then bang': 'a'.repeat(N) + '!',
    'open-paren-space': '( '.repeat(N / 2),
    'unbalanced open': '('.repeat(N),
    'unbalanced close': ')'.repeat(N),
    fractions: '1/'.repeat(N / 2),
    'mixed numbers': '1 1/2 '.repeat(N / 6),
    dashes: ' - '.repeat(N / 3),
    digits: '1'.repeat(N),
    'for the': 'for the '.repeat(N / 8),
    'combining marks': 'é'.repeat(N / 2),
    'zero width': 'a​'.repeat(N / 2),
    emoji: '\u{1F600}'.repeat(N / 2),
    spaces: ' '.repeat(N),
    'degree digits': '350°'.repeat(N / 4),
    minutes: '10 min '.repeat(N / 7),
  };

  it('registers at least the known patterns', () => {
    expect(MAPPER_PATTERNS.length).toBeGreaterThanOrEqual(2);
    const names = MAPPER_PATTERNS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { name, re } of MAPPER_PATTERNS) {
    for (const [label, input] of Object.entries(adversarial)) {
      it(`${name} survives "${label}" in under 20 ms`, () => {
        const { ms } = timed(() => {
          re.lastIndex = 0;
          return re.test(input);
        });
        expect(ms).toBeLessThan(20);
      });
    }
  }
});

describe('source scan of the mapper modules', () => {
  const sources = MAPPER_FILES.map((f) => ({ f, src: readFileSync(f, 'utf8') }));
  const forbidden: Array<[string, RegExp]> = [
    ['new RegExp(', /new\s+RegExp\s*\(/],
    ['RegExp( call', /(^|[^.\w])RegExp\s*\(/],
    ['eval(', /(^|[^.\w])eval\s*\(/],
    ['Function(', /(^|[^.\w])Function\s*\(/],
    ['Date.now', /Date\.now/],
    ['new Date', /new\s+Date/],
    ['Math.random', /Math\.random/],
    ['performance.now', /performance\.now/],
    ['setTimeout', /setTimeout|setInterval/],
    ['process', /\bprocess\./],
    ['fetch(', /(^|[^.\w])fetch\s*\(/],
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['LLM client', /anthropic|openai|@ai-sdk|langchain/i],
    [
      'regex-taking string method',
      /\.(match|matchAll|replace|replaceAll|split|search|exec)\(\s*\//,
    ],
  ];
  for (const [label, re] of forbidden) {
    it(`no ${label}`, () => {
      const hits = sources.filter(({ src }) => re.test(src)).map(({ f }) => f);
      expect(hits).toEqual([]);
    });
  }

  it('imports only from the mapper area, grid validation and recipe schemas', () => {
    const allowed = (spec: string) =>
      spec.startsWith('./') || spec === '@/lib/grid/validate' || spec === '@/lib/recipes/schemas';
    const bad: string[] = [];
    for (const { f, src } of sources) {
      for (const m of src.matchAll(
        /(?:^|\n)\s*(?:import|export)[^'"\n;]*?from\s+['"]([^'"]+)['"]/g,
      )) {
        if (!allowed(m[1]!)) bad.push(`${f}: ${m[1]}`);
      }
      for (const m of src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
        if (!allowed(m[1]!)) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the modules reached through ./ imports are pure too', () => {
    const extra = ['src/lib/import/ingredient-parser.ts'];
    for (const f of extra) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/from\s+['"](node:|fs|net|dns|react|next|@\/lib\/db)/);
    }
  });
});

describe('input caps (G10)', () => {
  const base = (): MapInput => ({
    ingredients: [ing('flour'), ing('sugar')],
    steps: [
      { text: 'Mix the flour and sugar.', section: null },
      { text: 'Bake.', section: null },
    ],
  });
  const warningsOf = (r: ReturnType<typeof mapGrid>) =>
    r.mapped ? r.proposal.warnings : r.warnings;

  it('201 ingredients are truncated to 200', () => {
    const input = base();
    input.ingredients = Array.from({ length: 201 }, (_, i) => ing(`item${i}`));
    input.ingredients[0] = ing('flour');
    const r = mapGrid(input);
    expect(warningsOf(r)).toContain('input_truncated');
    if (r.mapped) expect(r.proposal.sections.flatMap((s) => s.ingredients)).toHaveLength(200);
  });

  it('101 steps are truncated to 100', () => {
    const input = base();
    input.steps = Array.from({ length: 101 }, (_, i) => ({
      text: `Stir the flour ${i}.`,
      section: null,
    }));
    const r = mapGrid(input);
    expect(warningsOf(r)).toContain('input_truncated');
    if (r.mapped) expect(r.proposal.sections.flatMap((s) => s.steps)).toHaveLength(100);
  });

  it('a 4001-character step is cut to 4000', () => {
    const input = base();
    input.steps[0] = { text: 'Stir the flour. ' + 'x'.repeat(4001), section: null };
    const r = mapGrid(input);
    expect(warningsOf(r)).toContain('input_truncated');
    if (r.mapped)
      expect(r.proposal.sections[0]!.steps[0]!.detail.length).toBeLessThanOrEqual(
        MAP_LIMITS.stepChars,
      );
  });

  it('801 tokens in a step are accepted with a warning', () => {
    const input = base();
    input.steps[0] = {
      text: 'Stir the flour ' + Array.from({ length: 800 }, (_, i) => `w${i}`).join(' '),
      section: null,
    };
    const r = mapGrid(input);
    expect(warningsOf(r)).toContain('input_truncated');
  });

  it('100 steps of 4000 characters hit the total cap, not the process', () => {
    const input = base();
    input.steps = Array.from({ length: 100 }, () => ({
      text: 'flour '.repeat(666),
      section: null,
    }));
    const r = mapGrid(input);
    expect(warningsOf(r)).toContain('input_truncated');
  });

  it('a 200-character-plus ingredient name is cut to 200', () => {
    const input = base();
    input.ingredients = [ing('flour ' + 'x'.repeat(300))];
    const r = mapGrid(input);
    if (r.mapped)
      expect(r.proposal.sections[0]!.ingredients[0]!.name.length).toBeLessThanOrEqual(200);
  });
});

describe('maximum-size inputs finish quickly and deterministically', () => {
  const words = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
  const cases: Record<string, () => MapInput> = {
    '200 identical ingredient names, steps naming them': () => ({
      ingredients: Array.from({ length: 200 }, () => ing('sugar')),
      steps: Array.from({ length: 100 }, () => ({
        text: 'Stir the sugar. '.repeat(250),
        section: null,
      })),
    }),
    '100 steps x 4000 chars of one ingredient token': () => ({
      ingredients: [ing('flour'), ing('sugar')],
      steps: Array.from({ length: 100 }, () => ({ text: 'flour '.repeat(666), section: null })),
    }),
    '100 steps of 800 distinct tokens with 200 ingredients of 8-token names': () => ({
      ingredients: Array.from({ length: 200 }, (_, i) => ing(`${words(8, `t${i}x`)}`)),
      steps: Array.from({ length: 100 }, (_, s) => ({ text: words(800, `t${s}x`), section: null })),
    }),
    'ingredients that share a long prefix': () => ({
      ingredients: Array.from({ length: 200 }, (_, i) => ing(`${'a '.repeat(7)}b${i}`)),
      steps: Array.from({ length: 100 }, () => ({ text: 'a '.repeat(790) + 'b1', section: null })),
    }),
    'deeply nested parentheses in steps and names': () => ({
      ingredients: [ing('('.repeat(150) + 'flour' + ')'.repeat(150)), ing('sugar')],
      steps: Array.from({ length: 100 }, () => ({
        text: '('.repeat(1900) + 'flour' + ')'.repeat(1900),
        section: null,
      })),
    }),
    'unbalanced parentheses everywhere': () => ({
      ingredients: [ing('flour'), ing('sugar')],
      steps: Array.from({ length: 100 }, () => ({ text: '(sugar '.repeat(500), section: null })),
    }),
    '100 headings (sections explosion)': () => ({
      ingredients: [ing('flour')],
      steps: Array.from({ length: 100 }, (_, i) => ({ text: `For the part ${i}:`, section: null })),
    }),
    '100 HowToSection hints': () => ({
      ingredients: [ing('flour')],
      steps: Array.from({ length: 100 }, (_, i) => ({
        text: 'Stir the flour.',
        section: `Part ${i}`,
      })),
    }),
    'repeated "for the " and temperatures': () => ({
      ingredients: [ing('flour')],
      steps: Array.from({ length: 100 }, () => ({
        text: 'for the '.repeat(300) + '350°F '.repeat(200),
        section: null,
      })),
    }),
    'combining marks and zero-width characters': () => ({
      ingredients: [ing('flour')],
      steps: Array.from({ length: 100 }, () => ({ text: 'é​'.repeat(2000), section: null })),
    }),
  };
  for (const [label, make] of Object.entries(cases)) {
    it(`${label}`, () => {
      const input = make();
      const a = timed(() => mapGrid(input));
      const b = mapGrid(make());
      expect(a.ms).toBeLessThan(250);
      expect(typeof a.value.mapped).toBe('boolean');
      expect(a.value).toEqual(b);
    });
  }
});

describe('operation budget', () => {
  it('returns budget with mapping_budget when exhausted', () => {
    const input: MapInput = {
      ingredients: [ing('flour'), ing('sugar')],
      steps: [
        { text: 'Mix the flour and sugar.', section: null },
        { text: 'Bake.', section: null },
      ],
    };
    expect(mapGrid(input, { budget: 3 })).toEqual({
      mapped: false,
      reason: 'budget',
      warnings: ['mapping_budget'],
    });
  });

  it('the default budget is finite and exceeded by pathological input without throwing', () => {
    const input: MapInput = {
      ingredients: Array.from({ length: 200 }, (_, i) => ing(`${'a '.repeat(7)}b${i}`)),
      steps: Array.from({ length: 100 }, () => ({ text: 'a '.repeat(790) + 'b1', section: null })),
    };
    const r = mapGrid(input, { budget: 50_000 });
    expect(r).toMatchObject({ mapped: false, reason: 'budget' });
  });

  it('is deterministic across budget outcomes', () => {
    const input: MapInput = {
      ingredients: [ing('flour')],
      steps: [{ text: 'Stir the flour.', section: null }],
    };
    expect(mapGrid(input, { budget: 5 })).toEqual(mapGrid(input, { budget: 5 }));
  });
});

describe('hostile content stays inert data', () => {
  const hostile = [
    '<script>alert(1)</script> Stir the flour.',
    'javascript:alert(1) then mix the flour.',
    'Mix the flour &lt;b&gt;bold&lt;/b&gt; &amp; sugar.',
    '<img src=x onerror=alert(1)> Add the sugar.',
    'Bake. ${process.exit(1)} `rm -rf /` {{constructor.constructor("x")()}}',
  ];
  it('maps step text verbatim into detail without interpreting it', () => {
    const input: MapInput = {
      ingredients: [ing('flour'), ing('sugar')],
      steps: hostile.map((text) => ({ text, section: null })),
    };
    const r = mapGrid(input);
    expect(r.mapped).toBe(true);
    if (r.mapped) {
      expect(r.proposal.sections.flatMap((s) => s.steps.map((st) => st.detail))).toEqual(hostile);
    }
  });

  it('keeps hostile ingredient names as plain strings and never throws', () => {
    const names = [
      '<script>x</script>',
      'javascript:alert(1)',
      '"><img src=x>',
      '__proto__',
      'constructor',
    ];
    const input: MapInput = {
      ingredients: names.map((n) => ing(n)),
      steps: [
        { text: 'Stir the __proto__ and the constructor.', section: null },
        { text: 'Bake.', section: null },
      ],
    };
    const r = mapGrid(input);
    expect(typeof r.mapped).toBe('boolean');
    if (r.mapped) {
      expect(r.proposal.sections.flatMap((s) => s.ingredients.map((i) => i.name)).sort()).toEqual(
        [...names].sort(),
      );
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('a heading-shaped hostile step title is data, not markup', () => {
    const r = mapGrid({
      ingredients: [ing('flour')],
      steps: [
        { text: 'For the <b>x</b>:', section: null },
        { text: 'Stir the flour.', section: null },
      ],
    });
    expect(typeof r.mapped).toBe('boolean');
  });
});
