import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapGrid } from './map-grid';
import { Warnings } from './map-warnings';
import { nameTokens } from './ingredient-match';
import { parseIngredientLine, toIngredientFields } from './ingredient-parser';
import { ingredientsFromLines } from './map-sections';
import { safeSlice, singularize } from './text-tokens';
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
// exercised here. The assertions are on the deterministic operation count (`onUsed`), never on
// elapsed time; the only wall-clock checks are very generous backstops (BACKSTOP_MS) that
// catch an outright hang and cannot flake on a loaded CI runner.

const MAPPER_FILES = [
  'ingredient-match',
  'map-confidence',
  'map-grid',
  'map-patterns',
  'map-sections',
  'map-split',
  'map-types',
  'map-warnings',
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

/** Generous hang detector only; correctness is asserted on operation counts. */
const BACKSTOP_MS = 10_000;

/** Run the mapper and report the operations it counted. */
function counted(input: MapInput, budget?: number) {
  let used = -1;
  const value = mapGrid(input, { budget, onUsed: (u) => (used = u) });
  return { value, used };
}

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
      it(`${name} survives "${label}"`, () => {
        const { ms } = timed(() => {
          re.lastIndex = 0;
          return re.test(input);
        });
        expect(ms).toBeLessThan(BACKSTOP_MS);
      });
    }
  }
});

/**
 * Regular-expression literals of a TypeScript source, found by a small scanner that skips
 * comments, strings and template literals. A `/` starts a regex when the previous
 * significant character cannot end an expression.
 */
function regexLiterals(src: string): Array<{ literal: string; before: string }> {
  const out: Array<{ literal: string; before: string }> = [];
  let i = 0;
  let prev = '';
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < n && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      prev = c;
      continue;
    }
    if (c === '/') {
      const startsRegex = prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev);
      if (startsRegex) {
        const start = i;
        i++;
        let inClass = false;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') i += 2;
          else if (src[i] === '[' || src[i] === ']') {
            inClass = src[i] === '[';
            i++;
          } else if (src[i] === '/' && !inClass) break;
          else i++;
        }
        i++;
        while (i < n && /[a-z]/.test(src[i]!)) i++;
        out.push({
          literal: src.slice(start, i),
          before: src.slice(Math.max(0, start - 60), start),
        });
        prev = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

describe('regex literal scanner (self-test)', () => {
  it('finds bare literals and ignores strings, comments and division', () => {
    const src = [
      'const A = /(a+)+$/; // /not/',
      "const s = 'x/y/z' + `/t/`; const q = a / b / c;",
      "/* /c/ */ const R = pattern('r', /^[\\p{L}/]$/u);",
      "x.replace(/a/g, '');",
    ].join('\n');
    expect(regexLiterals(src).map((r) => r.literal)).toEqual([
      '/(a+)+$/',
      '/^[\\p{L}/]$/u',
      '/a/g',
    ]);
  });
});

describe('source scan of the mapper modules', () => {
  it('has no regex literal outside a registered pattern() call', () => {
    const bad: string[] = [];
    for (const f of MAPPER_FILES) {
      if (f.endsWith('map-patterns.ts')) continue;
      for (const { literal, before } of regexLiterals(readFileSync(f, 'utf8'))) {
        if (!/pattern\(\s*'[\w-]+'\s*,\s*$/.test(before)) bad.push(`${f}: ${literal}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every registered pattern call is a literal that the registry lists', () => {
    let calls = 0;
    for (const f of MAPPER_FILES) {
      if (f.endsWith('map-patterns.ts')) continue;
      calls += [...readFileSync(f, 'utf8').matchAll(/pattern\(\s*'([\w-]+)'/g)].length;
    }
    expect(MAPPER_PATTERNS.length).toBe(calls);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

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
      // The parser owns many regex literals (fuzzed below). Its two `new RegExp` calls
      // interpolate constant tables only (NUM_SRC, VF); pin the count so that any new one
      // needs a review.
      expect(src.match(/new\s+RegExp\s*\(/g)).toHaveLength(2);
      expect(src).not.toMatch(/Date\.now|Math\.random|\beval\s*\(/);
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
      const a = counted(make());
      const b = counted(make());
      // Work is bounded by the budget (one spend may overshoot by at most the candidate
      // count of a single mention) and a budget stop is a clean list-mode failure.
      expect(a.used).toBeGreaterThanOrEqual(0);
      expect(a.used).toBeLessThanOrEqual(MAP_LIMITS.budget + MAP_LIMITS.ingredients);
      if (a.value.mapped) expect(a.used).toBeLessThanOrEqual(MAP_LIMITS.budget);
      else if (a.value.reason === 'budget') {
        expect(a.value.warnings).toEqual(['mapping_budget']);
      }
      // Deterministic: same result and same operation count.
      expect(a.value).toEqual(b.value);
      expect(a.used).toBe(b.used);
    });
  }

  it('finishes all maximum-size cases within the hang backstop', () => {
    const { ms } = timed(() => {
      for (const make of Object.values(cases)) mapGrid(make());
    });
    expect(ms).toBeLessThan(BACKSTOP_MS * 3);
  });
});

describe('per-mention candidate work is charged (security F1)', () => {
  // 200 ingredients "w<i> s" all share the level-4 head noun "s"; 75 steps of 799 "s".
  const manyCandidates = (): MapInput => ({
    ingredients: Array.from({ length: 200 }, (_, i) => ing(`w${i} s`)),
    steps: Array.from({ length: 75 }, () => ({ text: 's '.repeat(799), section: null })),
  });

  it('the shape that cost ~300 ms uncharged now exhausts the budget', () => {
    const r = counted(manyCandidates());
    expect(r.value).toMatchObject({ mapped: false, reason: 'budget' });
    expect(r.used).toBeGreaterThan(MAP_LIMITS.budget);
  });

  it('charges at least the candidate-set size for each mention', () => {
    // Same ingredient count and step shape; only the candidate set of the mention differs.
    const shared: MapInput = {
      ingredients: Array.from({ length: 200 }, (_, i) => ing(`w${i} s`)),
      steps: [{ text: 'Stir s.', section: null }],
    };
    const unique: MapInput = {
      ingredients: Array.from({ length: 200 }, (_, i) => ing(`w${i} s${i}`)),
      steps: [{ text: 'Stir s0.', section: null }],
    };
    expect(counted(shared).used - counted(unique).used).toBeGreaterThanOrEqual(199);
  });

  it('200 identical names are one candidate set per mention and stay bounded', () => {
    const r = counted({
      ingredients: Array.from({ length: 200 }, () => ing('sugar')),
      steps: Array.from({ length: 100 }, () => ({
        text: 'Stir the sugar. '.repeat(250),
        section: null,
      })),
    });
    expect(r.used).toBeLessThanOrEqual(MAP_LIMITS.budget + MAP_LIMITS.ingredients);
  });
});

describe('caller budget is clamped to the default (security F6)', () => {
  const shared = (): MapInput => ({
    ingredients: Array.from({ length: 200 }, (_, i) => ing(`${'a '.repeat(7)}b${i}`)),
    steps: Array.from({ length: 100 }, () => ({ text: 'a '.repeat(790) + 'b1', section: null })),
  });
  it('a huge budget behaves like the default', () => {
    for (const huge of [1e12, Number.MAX_SAFE_INTEGER, Infinity]) {
      const r = counted(shared(), huge);
      const d = counted(shared());
      expect(r.value).toEqual(d.value);
      expect(r.used).toBe(d.used);
    }
    expect(counted(shared(), 1e12).value).toMatchObject({ mapped: false, reason: 'budget' });
  });
  it('a smaller budget is honoured', () => {
    expect(counted(shared(), 1000).used).toBeLessThan(MAP_LIMITS.budget);
  });
});

describe('warnings never drop meaningful codes (security F4)', () => {
  const twoDurations = 'Bake 10 minutes, then rest 5 minutes.';
  const unmentioned = (n: number): MapInput => ({
    ingredients: [ing('flour'), ...Array.from({ length: n }, (_, i) => ing(`item${i}`))],
    steps: [
      { text: 'Stir the flour.', section: null },
      { text: twoDurations, section: null },
    ],
  });
  it('200 unmentioned ingredients still report time_ambiguous', () => {
    const r = mapGrid(unmentioned(199));
    expect(r.mapped).toBe(true);
    const w = r.mapped ? r.proposal.warnings : [];
    expect(w).toContain('time_ambiguous');
    expect(w.filter((x) => x.startsWith('ingredient_unmentioned:'))).toHaveLength(10);
    expect(w).toContain('warnings_more:189');
    expect(w.length).toBeLessThanOrEqual(60);
  });
  it('few unmentioned ingredients are all listed with no summary', () => {
    const r = mapGrid(unmentioned(3));
    const w = r.mapped ? r.proposal.warnings : [];
    expect(w.filter((x) => x.startsWith('ingredient_unmentioned:'))).toHaveLength(3);
    expect(w.some((x) => x.startsWith('warnings_more:'))).toBe(false);
  });
  it('fixed codes come first and are never cut, whatever the volume', () => {
    const w = new Warnings();
    for (let i = 0; i < 500; i++) w.add(`ingredient_unmentioned:n${i}`);
    for (let i = 0; i < 500; i++) w.add(`ambiguous_name:t${i}`);
    for (let i = 0; i < 500; i++) w.add(`split_unresolved:s${i}`);
    w.add('mapping_invalid');
    w.add('time_ambiguous');
    const list = w.list();
    expect(list.slice(0, 2)).toEqual(['mapping_invalid', 'time_ambiguous']);
    expect(list).toContain('warnings_more:1470');
    expect(list.length).toBe(2 + 30 + 1);
    expect(w.has('mapping_invalid')).toBe(true);
  });
  it('the budget failure keeps mapping_budget', () => {
    expect(mapGrid(unmentioned(199), { budget: 5 })).toMatchObject({
      mapped: false,
      warnings: ['mapping_budget'],
    });
  });
});

describe('plain-object lookups are gone (security F5)', () => {
  it('singularize never returns a non-string for inherited property names', () => {
    for (const w of ['constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']) {
      expect(typeof singularize(w)).toBe('string');
    }
    expect(singularize('constructor')).toBe('constructor');
    expect(nameTokens('constructor')).toEqual(['constructor']);
  });
  it('an ingredient named "constructor" is mapped by name, with sane ids', () => {
    const r = mapGrid({
      ingredients: [ing('flour'), ing('constructor')],
      steps: [
        { text: 'Mix the constructor with the flour.', section: null },
        { text: 'Bake.', section: null },
      ],
    });
    expect(r.mapped).toBe(true);
    if (!r.mapped) return;
    const rows = r.proposal.sections[0]!.ingredients;
    expect(rows.map((i) => i.name)).toEqual(['constructor', 'flour']);
    for (const i of rows) expect(i.split_group_id).toBeNull();
    expect(r.proposal.warnings.some((w) => w.includes('function'))).toBe(false);
  });
  it('two distinct constructor-like names do not collide', () => {
    const r = mapGrid({
      ingredients: [ing('constructor'), ing('prototype')],
      steps: [{ text: 'Stir the constructor, then the prototype.', section: null }],
    });
    expect(r.mapped).toBe(true);
    if (r.mapped) {
      expect(r.proposal.sections[0]!.ingredients.map((i) => i.name)).toEqual([
        'constructor',
        'prototype',
      ]);
    }
  });
});

describe('slicing never leaves a lone surrogate (security F7)', () => {
  const wellFormed = (s: string) => s.isWellFormed();
  it('safeSlice cuts before a split pair', () => {
    expect(safeSlice('ab\u{1F600}cd', 3)).toBe('ab');
    expect(safeSlice('ab\u{1F600}cd', 4)).toBe('ab\u{1F600}');
    expect(safeSlice('abc', 10)).toBe('abc');
    expect(safeSlice('abc', 0)).toBe('');
  });
  it('step label, ingredient name, detail and heading stay well formed', () => {
    const pair = '\u{1F600}';
    const name = 'x'.repeat(199) + pair + 'tail';
    const longStep = 'Stir the flour. ' + 'y'.repeat(MAP_LIMITS.stepChars - 17) + pair + 'zzz';
    const r = mapGrid({
      ingredients: [ing(name), ing('flour')],
      steps: [
        { text: 'x'.repeat(23) + pair + ' stir the flour.', section: null },
        { text: longStep, section: null },
      ],
    });
    expect(r.mapped).toBe(true);
    if (!r.mapped) return;
    for (const s of r.proposal.sections) {
      for (const i of s.ingredients) expect(wellFormed(i.name)).toBe(true);
      for (const st of s.steps) {
        expect(wellFormed(st.label)).toBe(true);
        expect(wellFormed(st.detail)).toBe(true);
      }
    }
    expect(r.proposal.sections[0]!.steps[1]!.detail.length).toBeLessThanOrEqual(
      MAP_LIMITS.stepChars,
    );
    expect(r.proposal.warnings.every(wellFormed)).toBe(true);
  });
  it('ingredientsFromLines caps a line without splitting a pair', () => {
    const out = ingredientsFromLines(['1 cup ' + 'x'.repeat(494) + '\u{1F600}\u{1F600}']);
    expect(out[0]!.raw_text!.length).toBeLessThanOrEqual(500);
    expect(wellFormed(out[0]!.raw_text!)).toBe(true);
    expect(wellFormed(out[0]!.name)).toBe(true);
  });
});

describe('ingredient parser is bounded and linear (security F2)', () => {
  const runs = [';', ',', ':', ' ', '-', '.', '1', '(', ')', '1/', ' 1 ', '\t'];
  for (const run of runs) {
    for (const n of [4000, 80_000]) {
      it(`parseIngredientLine copes with ${n} x ${JSON.stringify(run)} (cap, then parse)`, () => {
        const lines = [
          '1 cup flour' + run.repeat(n) + 'x',
          run.repeat(n) + '1 cup flour',
          '2 ' + run.repeat(n),
        ];
        for (const line of lines) {
          const p = parseIngredientLine(line);
          expect(p.raw_text!.length).toBeLessThanOrEqual(500);
          const f = toIngredientFields(p);
          expect(f.name.length).toBeLessThanOrEqual(500);
          expect(f.raw_text.length).toBeLessThanOrEqual(500);
        }
      });
    }
  }
  it('ingredientsFromLines passes at most 500 characters per line to the parser', () => {
    const out = ingredientsFromLines(['1 cup flour' + ';'.repeat(500_000) + 'x']);
    expect(out).toHaveLength(1);
    expect(out[0]!.raw_text!.length).toBeLessThanOrEqual(500);
    expect(out[0]!.name.length).toBeLessThanOrEqual(MAP_LIMITS.ingredientNameChars);
  });
  it('mapGrid with a 500k-character ingredient line completes within the backstop', () => {
    const { ms, value } = timed(() =>
      mapGrid({
        ingredients: ingredientsFromLines(['1 cup flour' + ';'.repeat(500_000) + 'x']),
        steps: [{ text: 'Stir the flour.', section: null }],
      }),
    );
    expect(value.mapped).toBe(true);
    expect(ms).toBeLessThan(BACKSTOP_MS);
  });
});

describe('unicode normalization keeps offsets aligned (v0.3.0 F2 class)', () => {
  const total = (): IngredientInput =>
    ing('sugar', { metric_qty: 300, metric_unit: 'g', raw_text: '300 g sugar' });
  it('lengths that change under NFKC do not shift split portions', () => {
    // "İ" lowercases to two code units, "ﬃ" expands to three under NFKC.
    const r = mapGrid({
      ingredients: [total(), ing('butter')],
      steps: [
        { text: 'İİİ ﬃ stir 100 g sugar into the butter.', section: null },
        { text: 'Add the remaining sugar.', section: null },
        { text: 'Bake.', section: null },
      ],
    });
    expect(r.mapped).toBe(true);
    if (!r.mapped) return;
    const sugar = r.proposal.sections[0]!.ingredients.filter((i) => i.name === 'sugar');
    expect(sugar.map((i) => i.metric_qty)).toEqual([100, 200]);
    expect(sugar.map((i) => i.portion_label)).toEqual(['100 g', 'remaining']);
  });
  it('a "half" marker after "İ" still resolves', () => {
    const r = mapGrid({
      ingredients: [ing('sugar', { metric_qty: 200, metric_unit: 'g' }), ing('butter')],
      steps: [
        { text: 'İİİ cream the butter with half of the sugar.', section: null },
        { text: 'Fold in the remaining sugar.', section: null },
        { text: 'Bake.', section: null },
      ],
    });
    expect(r.mapped).toBe(true);
    if (!r.mapped) return;
    const sugar = r.proposal.sections[0]!.ingredients.filter((i) => i.name === 'sugar');
    expect(sugar.map((i) => i.portion_label)).toEqual(['half', 'remaining']);
    expect(sugar.map((i) => i.metric_qty)).toEqual([100, 100]);
  });
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
    expect(r.mapped).toBe(true);
    if (r.mapped) {
      expect(r.proposal.sections.flatMap((s) => s.ingredients.map((i) => i.name)).sort()).toEqual(
        [...names].sort(),
      );
      const constructorRow = r.proposal.sections[0]!.ingredients.find(
        (i) => i.name === 'constructor',
      )!;
      expect(constructorRow.split_group_id).toBeNull();
      expect(r.proposal.warnings.every((w) => typeof w === 'string')).toBe(true);
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
