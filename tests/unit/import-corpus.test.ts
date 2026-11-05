import { describe, expect, it, vi } from 'vitest';
import { runCorpus, TARGET } from '../../scripts/import-corpus';

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
});
