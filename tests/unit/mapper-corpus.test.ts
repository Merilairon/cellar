import { describe, expect, it } from 'vitest';
import { mapperFixtureBytes, runMapperCorpus } from '../../scripts/mapper-corpus';

// CI guard for the auto-mapper accuracy gates (owner decision Q5). Mirrors the exit code of
// `npm run test:mapper`.

const report = runMapperCorpus();

describe('auto-mapper corpus gates', () => {
  it('has at least 30 mapper fixtures under 300 KB', () => {
    expect(report.fixtureCount).toBeGreaterThanOrEqual(30);
    expect(mapperFixtureBytes()).toBeLessThan(300 * 1024);
  });

  it('reproduces every reference exactly at confidence >= 0.70', () => {
    const refs = report.rows.filter((r) => r.cls === 'reference');
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const r of refs) {
      expect(r.problems, r.name).toEqual([]);
      expect(r.match, r.name).toBe('EXACT');
      expect(r.confidence ?? 0, r.name).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('maps at least 90 percent of the clean set exactly and 95 percent of its steps', () => {
    expect(report.clean.exact / report.clean.total).toBeGreaterThanOrEqual(0.9);
    expect(report.clean.stepsRight / report.clean.stepsTotal).toBeGreaterThanOrEqual(0.95);
  });

  it('has no confident-wrong fixture (wrong structure scoring >= 0.70)', () => {
    expect(report.confidentWrong.map((r) => r.name)).toEqual([]);
  });

  it('ends every negative fixture as list or none below 0.70', () => {
    for (const r of report.rows.filter((x) => x.cls === 'negative')) {
      expect(r.problems, r.name).toEqual([]);
      expect(['list', 'none']).toContain(r.gotView);
    }
  });

  it('every fixture meets the expectations it states, except the reported hard misses', () => {
    const failing = report.rows.filter((r) => !r.ok && r.cls !== 'hard').map((r) => r.name);
    expect(failing).toEqual([]);
  });

  it('passes all gates', () => {
    expect(report.gates.filter((g) => !g.pass)).toEqual([]);
    expect(report.pass).toBe(true);
  });
});
