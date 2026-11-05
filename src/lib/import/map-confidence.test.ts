import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLDS, computeConfidence, levelOf } from './map-confidence';
import type { MappingSignals } from './map-types';

const perfect: MappingSignals = {
  cov: 1,
  unamb: 1,
  verbs: 1,
  splitOk: 1,
  secFactor: 1,
  groupRefs: 0,
  columnSteps: 5,
  distinctSpans: 4,
};
const s = (o: Partial<MappingSignals>): MappingSignals => ({ ...perfect, ...o });

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

describe('computeConfidence table', () => {
  it('perfect signals give 1.00 (sample A)', () => {
    expect(computeConfidence(perfect)).toEqual({ confidence: 1, level: 'high' });
  });
  it('sample B shape stays >= 0.90', () => {
    expect(
      computeConfidence(s({ columnSteps: 7, distinctSpans: 6 })).confidence,
    ).toBeGreaterThanOrEqual(0.9);
  });
  it('9 of 10 matched is 0.81, 8 of 10 is 0.64 (medium)', () => {
    expect(computeConfidence(s({ cov: 0.9 })).confidence).toBe(0.81);
    expect(computeConfidence(s({ cov: 0.8 }))).toEqual({ confidence: 0.64, level: 'medium' });
  });
  it('any unresolved split is never high (review M2): capped at 0.69', () => {
    expect(computeConfidence(s({ splitOk: 0 }))).toEqual({ confidence: 0.69, level: 'medium' });
    expect(computeConfidence(s({ splitOk: 0.99 })).level).not.toBe('high');
    expect(computeConfidence(s({ splitOk: 1 })).level).toBe('high');
  });
  it('the split cap does not raise a score that is already lower', () => {
    expect(computeConfidence(s({ splitOk: 0, cov: 0.5 })).confidence).toBeLessThan(0.69);
  });
  it('two sections that each span all their rows are not one distinct span (review m2)', () => {
    expect(computeConfidence(s({ distinctSpans: 2, columnSteps: 4 })).confidence).toBe(1);
  });
  it('one group reference subtracts 0.05, capped at 0.15', () => {
    expect(computeConfidence(s({ groupRefs: 1 })).confidence).toBe(0.95);
    expect(computeConfidence(s({ groupRefs: 9 })).confidence).toBe(0.85);
  });
  it('section factor multiplies and floors at 0.5', () => {
    expect(computeConfidence(s({ secFactor: 0.85 })).confidence).toBe(0.85);
    expect(computeConfidence(s({ secFactor: 0.1 })).confidence).toBe(0.5);
  });
  it('caps: fewer than 2 columns -> 0.50', () => {
    expect(computeConfidence(s({ columnSteps: 1, distinctSpans: 1 })).confidence).toBe(0.5);
    expect(computeConfidence(s({ columnSteps: 0, distinctSpans: 0 })).confidence).toBe(0.5);
  });
  it('caps: one distinct span -> 0.55', () => {
    expect(computeConfidence(s({ columnSteps: 4, distinctSpans: 1 })).confidence).toBe(0.55);
  });
  it('caps: more than 30 percent unmatched -> 0.60', () => {
    expect(computeConfidence(s({ cov: 0.69 })).confidence).toBeLessThanOrEqual(0.6);
    expect(computeConfidence(s({ cov: 0.7 })).confidence).toBeCloseTo(0.49, 2);
  });
  it('caps: no recognized verb at all -> low (0.39)', () => {
    expect(computeConfidence(s({ verbs: 0 }))).toEqual({ confidence: 0.39, level: 'low' });
    expect(computeConfidence(s({ verbs: 0.2 })).level).toBe('high');
  });
  it('grid errors discard the proposal', () => {
    expect(computeConfidence(perfect, 1)).toEqual({ confidence: 0, level: 'low' });
  });
  it('no mentions at all is low', () => {
    expect(computeConfidence(s({ cov: 0 })).level).toBe('low');
  });
});

describe('levels', () => {
  it('exposes the owner-approved thresholds', () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({ high: 0.7, medium: 0.4 });
  });
  it('boundaries use the rounded value', () => {
    expect(levelOf(0.7)).toBe('high');
    expect(levelOf(0.699)).toBe('high'); // rounds to 0.70
    expect(levelOf(0.694)).toBe('medium');
    expect(levelOf(0.4)).toBe('medium');
    expect(levelOf(0.39)).toBe('low');
    expect(levelOf(0)).toBe('low');
    expect(levelOf(1)).toBe('high');
  });
});

describe('properties (seeded, 500 cases)', () => {
  const gen = (r: () => number): MappingSignals => ({
    cov: r(),
    unamb: r(),
    verbs: r(),
    splitOk: r(),
    secFactor: 0.5 + r() * 0.5,
    groupRefs: Math.floor(r() * 5),
    columnSteps: Math.floor(r() * 8),
    distinctSpans: Math.floor(r() * 6),
  });
  it('is in [0,1], rounded to 2 decimals, deterministic', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const sig = gen(r);
      const a = computeConfidence(sig);
      expect(a).toEqual(computeConfidence(sig));
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(Math.round(a.confidence * 100) / 100).toBe(a.confidence);
    }
  });
  it('never rises when cov, unamb, verbs or splitOk decrease', () => {
    const r = rng(11);
    for (let i = 0; i < 500; i++) {
      const sig = gen(r);
      const base = computeConfidence(sig).confidence;
      for (const k of ['cov', 'unamb', 'verbs', 'splitOk'] as const) {
        const lower = { ...sig, [k]: sig[k] * r() };
        expect(computeConfidence(lower).confidence).toBeLessThanOrEqual(base);
      }
      expect(
        computeConfidence({ ...sig, groupRefs: sig.groupRefs + 1 }).confidence,
      ).toBeLessThanOrEqual(base);
    }
  });
});
