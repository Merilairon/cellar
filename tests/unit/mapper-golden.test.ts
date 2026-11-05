import { describe, expect, it } from 'vitest';
import { mapGrid } from '@/lib/import/map-grid';
import { SAMPLE_RECIPES, SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { loadMapperFixtures, fixtureToInput } from '../../scripts/mapper-corpus';
import {
  compareStructure,
  deriveMapInput,
  normalizeExpected,
  structureOf,
} from '../helpers/mapper-structure';

// Golden tests (tasklist G1, owner decision Q1): the mapper input is derived from the sample
// recipes themselves, so changing a sample without the mapper fails here. Structure only.

describe('derived input', () => {
  it('carries step text and ingredient fields but no kind, span or label', () => {
    const input = deriveMapInput(SAMPLE_SKILLET_COOKIES, 1);
    expect(input.steps.map((s) => Object.keys(s).sort())).toEqual(
      input.steps.map(() => ['section', 'text']),
    );
    expect(input.steps.map((s) => s.text)).toEqual(
      SAMPLE_SKILLET_COOKIES.sections[0]!.steps.map((s) => s.detail),
    );
    expect(input.ingredients).toHaveLength(9);
  });

  it('collapses split rows to one line with summed quantities', () => {
    const input = deriveMapInput(SAMPLE_VANILLA_CAKE, null);
    const sugar = input.ingredients.filter((i) => i.name === 'sugar');
    expect(sugar).toHaveLength(1);
    expect(sugar[0]!.us_qty).toBe(1);
    expect(sugar[0]!.metric_qty).toBe(200);
  });

  it('shuffles the ingredients', () => {
    const a = deriveMapInput(SAMPLE_SKILLET_COOKIES, 1).ingredients.map((i) => i.name);
    const b = deriveMapInput(SAMPLE_SKILLET_COOKIES, null).ingredients.map((i) => i.name);
    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...b].sort());
  });
});

describe.each([
  ['sample A (skillet cookies)', SAMPLE_SKILLET_COOKIES],
  ['sample B (vanilla cake)', SAMPLE_VANILLA_CAKE],
])('%s', (_name, sample) => {
  it('reproduces the reference structure with confidence >= 0.70 for 25 shuffles', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = mapGrid(deriveMapInput(sample, seed));
      expect(r.mapped, `seed ${seed}`).toBe(true);
      if (!r.mapped) continue;
      const cmp = compareStructure(structureOf(r.proposal.sections), structureOf(sample.sections));
      expect(cmp.exact, `seed ${seed}`).toBe(true);
      expect(r.proposal.confidence, `seed ${seed}`).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('gives the same proposal for every shuffle of the ingredient list', () => {
    const first = mapGrid(deriveMapInput(sample, 1));
    for (let seed = 2; seed <= 10; seed++) {
      expect(mapGrid(deriveMapInput(sample, seed))).toEqual(first);
    }
  });
});

describe('sample B detail', () => {
  it('splits sugar half/remaining in the Cake section only', () => {
    const r = mapGrid(deriveMapInput(SAMPLE_VANILLA_CAKE, 4));
    if (!r.mapped) throw new Error('unmapped');
    const [cake, frosting] = r.proposal.sections;
    expect(cake!.ingredients.filter((i) => i.split_group_id).map((i) => i.portion_label)).toEqual([
      'half',
      'remaining',
    ]);
    expect(frosting!.ingredients.some((i) => i.split_group_id)).toBe(false);
    expect(frosting!.steps.at(-1)!.kind).toBe('banner_bottom');
  });
});

describe('data-model brownie shape', () => {
  const entry = loadMapperFixtures().find((f) => f.name === 'reference-brownie')!;

  it('is checked in and expects the data-model section 2 spans', () => {
    const steps = entry.fx.expected.sections![0]!.steps;
    expect(
      steps.map((s) => (s.kind === 'column' ? `${s.row_start}-${s.row_end}` : s.kind)),
    ).toEqual(['banner_top', 'banner_top', '0-0', '0-3', '0-4', '0-8', '0-8']);
  });

  it('is reproduced exactly with confidence >= 0.70', () => {
    const r = mapGrid(fixtureToInput(entry.fx));
    if (!r.mapped) throw new Error('unmapped');
    const want = normalizeExpected(entry.fx.expected.sections!);
    expect(compareStructure(structureOf(r.proposal.sections), want).exact).toBe(true);
    expect(r.proposal.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe('samples list', () => {
  it('covers both golden samples', () => {
    expect(SAMPLE_RECIPES).toContain(SAMPLE_SKILLET_COOKIES);
    expect(SAMPLE_RECIPES).toContain(SAMPLE_VANILLA_CAKE);
  });
});
