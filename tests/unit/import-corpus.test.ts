import { describe, expect, it, vi } from 'vitest';
import { runCorpus, runHeadlessCorpus, TARGET } from '../../scripts/import-corpus';

describe('import fixture corpus', () => {
  it('keeps the static-handleable success rate at or above the target, offline', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access attempted');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const report = await runCorpus();
      expect(report.rows.length).toBeGreaterThanOrEqual(30);
      expect(report.rate).toBeGreaterThanOrEqual(TARGET);
      expect(report.overallRate).toBeGreaterThanOrEqual(TARGET);
      expect(report.overallRate).toBeLessThanOrEqual(report.rate);
      // Deliberate negatives and out-of-slice pages must behave as labelled.
      expect(report.failures.filter((r) => r.expect !== 'draft')).toEqual([]);
      expect(report.outOfSlice.length).toBeGreaterThan(0);
      expect(report.bytes).toBeLessThan(1024 * 1024);
      // Pipeline-level mapper fixtures (3b T7): normalize -> mapGrid wiring end to end.
      const mapRows = report.rows.filter((r) => r.name.startsWith('map-'));
      expect(mapRows.length).toBeGreaterThanOrEqual(3);
      expect(mapRows.filter((r) => !r.pass)).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('headless off: JS-only and blocked fixtures fail as before; on with the fake: they recover', async () => {
    const hl = await runHeadlessCorpus();
    expect(hl.off.rate).toBeGreaterThanOrEqual(TARGET);
    expect(hl.off.failures).toEqual([]);
    expect(hl.off.rows.find((r) => r.name === 'blocked-403-shell')?.got).toBe('no_recipe');
    expect(hl.on.failures).toEqual([]);
    expect(hl.on.overallRate).toBeGreaterThan(hl.off.overallRate);
    expect(hl.recovered.map((r) => r.name).sort()).toEqual([
      'blocked-403-shell',
      'js-only-hydration-state',
      'js-only-late-injected-jsonld',
      'js-only-spa-shell',
    ]);
    // Still blocked/paywalled after render are not inflated into the rate.
    expect(hl.stillRejected.map((r) => r.name).sort()).toEqual([
      'blocked-403-denied',
      'paywalled-js-shell',
    ]);
    // Microdata fixtures became drafts in 04a (T13); nothing stays out of slice with the sidecar on.
    expect(hl.stillOut).toEqual([]);
  });
});
