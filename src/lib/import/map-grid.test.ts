import { describe, expect, it } from 'vitest';
import { mapGrid } from './map-grid';
import type { MapInput } from './map-types';

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
