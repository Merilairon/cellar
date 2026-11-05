import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mapGrid } from '@/lib/import/map-grid';
import { ingredientsFromLines, stepHeadingTitle, titleKey } from '@/lib/import/map-sections';
import type { MapInput, MapResult } from '@/lib/import/map-types';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import {
  compareStructure,
  deriveMapInput,
  normalizeExpected,
  structureOf,
  type ExpectedSection,
} from '../tests/helpers/mapper-structure';

// Auto-mapper accuracy corpus (tasklist T8, owner decisions Q1, Q2, Q5). Offline and pure:
// the fixtures are hand-written JSON, the references are derived from samples.ts, and the
// mapper runs in-process. Nothing here is used by the app.

export const MAPPER_FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'mapper');
export const CLEAN_EXACT_TARGET = 0.9;
export const CLEAN_SPAN_TARGET = 0.95;
export const HIGH = 0.7;

export type FixtureClass = 'reference' | 'clean' | 'hard' | 'negative';
export type ExpectedStepParams = {
  kind: string;
  row_start?: number;
  row_end?: number;
  temp_f?: number;
  temp_c?: number;
  minutes_min?: number;
  minutes_max?: number;
};
export type MapperFixture = {
  class: FixtureClass;
  note: string;
  ingredients: string[];
  steps: Array<string | { text: string; section: string | null }>;
  expected: {
    view: 'grid' | 'list' | 'none';
    sections?: Array<Omit<ExpectedSection, 'steps'> & { steps: ExpectedStepParams[] }>;
    warnings_include?: string[];
  };
  confidence?: { min?: number; max?: number };
};

export type MapperRow = {
  name: string;
  cls: FixtureClass;
  expectView: 'grid' | 'list' | 'none';
  gotView: 'grid' | 'list' | 'none';
  confidence: number | null;
  level: string;
  match: 'EXACT' | 'PARTIAL' | 'MISS' | 'n/a';
  stepsRight: number;
  stepsTotal: number;
  warnings: string[];
  /** The fixture met every expectation it states. */
  ok: boolean;
  /** Structure or view differs from the expectation while confidence is high. */
  confidentWrong: boolean;
  problems: string[];
  ms: number;
};

export type MapperReport = {
  rows: MapperRow[];
  references: { total: number; ok: number };
  clean: { total: number; exact: number; stepsRight: number; stepsTotal: number };
  hard: { total: number; structured: number; exact: number; wrongBelowHigh: number; wrong: number };
  negatives: { total: number; ok: number };
  confidentWrong: MapperRow[];
  calibration: Array<{ bucket: string; total: number; exact: number }>;
  timing: { maxMs: number; medianMs: number };
  fixtureCount: number;
  bytes: number;
  gates: { name: string; pass: boolean; detail: string }[];
  pass: boolean;
};

// -- loading ----------------------------------------------------------------------------

export function loadMapperFixtures(): { name: string; fx: MapperFixture }[] {
  return readdirSync(MAPPER_FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: f.replace(/\.json$/, ''),
      fx: JSON.parse(readFileSync(join(MAPPER_FIXTURE_DIR, f), 'utf8')) as MapperFixture,
    }));
}

export function mapperFixtureBytes(): number {
  return readdirSync(MAPPER_FIXTURE_DIR).reduce(
    (n, f) => n + statSync(join(MAPPER_FIXTURE_DIR, f)).size,
    0,
  );
}

export function fixtureToInput(fx: MapperFixture): MapInput {
  const steps = fx.steps.map((s) =>
    typeof s === 'string' ? { text: s, section: null } : { text: s.text, section: s.section },
  );
  const known = new Set<string>();
  for (const s of steps) {
    if (s.section) known.add(titleKey(s.section));
    const h = stepHeadingTitle(s.text);
    if (h) known.add(titleKey(h));
  }
  return { ingredients: ingredientsFromLines(fx.ingredients, known), steps };
}

type Case = {
  name: string;
  cls: FixtureClass;
  input: MapInput;
  wantView: 'grid' | 'list' | 'none';
  want?: ReturnType<typeof normalizeExpected>;
  stepParams?: ExpectedStepParams[][];
  warnings?: string[];
  confidence?: { min?: number; max?: number };
};

/** References derived from the samples (G1): input from samples.ts, expected = the sample. */
export function referenceCases(): Case[] {
  const out: Case[] = [];
  const add = (name: string, recipe: typeof SAMPLE_SKILLET_COOKIES, seed: number | null) =>
    out.push({
      name,
      cls: 'reference',
      input: deriveMapInput(recipe, seed),
      wantView: 'grid',
      want: structureOf(recipe.sections),
      confidence: { min: HIGH },
    });
  add('reference-sample-a-shuffled', SAMPLE_SKILLET_COOKIES, 1);
  add('reference-sample-a-ordered', SAMPLE_SKILLET_COOKIES, null);
  add('reference-sample-b-shuffled', SAMPLE_VANILLA_CAKE, 2);
  add('reference-sample-b-ordered', SAMPLE_VANILLA_CAKE, null);
  return out;
}

function fixtureCases(): Case[] {
  return loadMapperFixtures().map(({ name, fx }) => ({
    name,
    cls: fx.class,
    input: fixtureToInput(fx),
    wantView: fx.expected.view,
    want: fx.expected.sections ? normalizeExpected(fx.expected.sections) : undefined,
    stepParams: fx.expected.sections?.map((s) => s.steps),
    warnings: fx.expected.warnings_include,
    confidence: fx.confidence,
  }));
}

// -- running ----------------------------------------------------------------------------

const viewOf = (r: MapResult): 'grid' | 'list' | 'none' =>
  !r.mapped ? 'none' : r.proposal.level === 'high' ? 'grid' : 'list';

const PARAM_KEYS = ['temp_f', 'temp_c', 'minutes_min', 'minutes_max'] as const;

function paramsMatch(r: MapResult, params: ExpectedStepParams[][] | undefined): boolean {
  if (!params || !r.mapped) return true;
  return params.every((steps, si) =>
    steps.every((want, k) => {
      const got = r.proposal.sections[si]?.steps[k];
      return PARAM_KEYS.every((key) => want[key] === undefined || got?.[key] === want[key]);
    }),
  );
}

function runCase(c: Case): MapperRow {
  const t0 = performance.now();
  const r = mapGrid(c.input);
  const ms = performance.now() - t0;
  const gotView = viewOf(r);
  const confidence = r.mapped ? r.proposal.confidence : null;
  const warnings = r.mapped ? r.proposal.warnings : r.warnings;
  let match: MapperRow['match'] = 'n/a';
  let stepsRight = 0;
  let stepsTotal = 0;
  let exact = true;
  if (c.want) {
    const cmp = compareStructure(r.mapped ? structureOf(r.proposal.sections) : null, c.want);
    stepsRight = cmp.stepsRight;
    stepsTotal = cmp.stepsTotal;
    exact = cmp.exact && paramsMatch(r, c.stepParams);
    match = exact ? 'EXACT' : cmp.stepsRight > 0 ? 'PARTIAL' : 'MISS';
  }
  const problems: string[] = [];
  if (c.want && !exact) problems.push('structure');
  if (gotView !== c.wantView) problems.push(`view ${gotView} != ${c.wantView}`);
  if (c.confidence?.min !== undefined && (confidence ?? 0) < c.confidence.min)
    problems.push('confidence below min');
  if (c.confidence?.max !== undefined && (confidence ?? 0) > c.confidence.max)
    problems.push('confidence above max');
  for (const w of c.warnings ?? [])
    if (!warnings.includes(w as never)) problems.push(`missing warning ${w}`);
  const highConf = (confidence ?? 0) >= HIGH;
  const structureWrong = c.want !== undefined && !exact;
  const viewWrong = (c.wantView === 'list' || c.wantView === 'none') && highConf;
  return {
    name: c.name,
    cls: c.cls,
    expectView: c.wantView,
    gotView,
    confidence,
    level: r.mapped ? r.proposal.level : '-',
    match,
    stepsRight,
    stepsTotal,
    warnings: warnings as string[],
    ok: problems.length === 0,
    confidentWrong: highConf && (structureWrong || viewWrong),
    problems,
    ms,
  };
}

export function runMapperCorpus(): MapperReport {
  const rows = [...referenceCases(), ...fixtureCases()].map(runCase);
  const by = (cls: FixtureClass) => rows.filter((r) => r.cls === cls);
  const refs = by('reference');
  const clean = by('clean');
  const hard = by('hard');
  const neg = by('negative');
  const exactOf = (rs: MapperRow[]) => rs.filter((r) => r.match === 'EXACT').length;
  const hardWrong = hard.filter((r) => r.match !== 'EXACT' && r.match !== 'n/a');

  const buckets = [
    { bucket: '0.00-0.39', lo: 0, hi: 0.4 },
    { bucket: '0.40-0.69', lo: 0.4, hi: 0.7 },
    { bucket: '0.70-1.00', lo: 0.7, hi: 1.01 },
  ];
  const withStructure = rows.filter((r) => r.match !== 'n/a');
  const calibration = buckets.map((b) => {
    const inB = withStructure.filter(
      (r) => (r.confidence ?? 0) >= b.lo && (r.confidence ?? 0) < b.hi,
    );
    return {
      bucket: b.bucket,
      total: inB.length,
      exact: inB.filter((r) => r.match === 'EXACT').length,
    };
  });

  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  const stepsRight = clean.reduce((n, r) => n + r.stepsRight, 0);
  const stepsTotal = clean.reduce((n, r) => n + r.stepsTotal, 0);
  const confidentWrong = rows.filter((r) => r.confidentWrong);
  const cleanExactRate = clean.length ? exactOf(clean) / clean.length : 0;
  const spanRate = stepsTotal ? stepsRight / stepsTotal : 0;

  const gates = [
    {
      name: 'references exact and confidence >= 0.70',
      pass: refs.length >= 4 && refs.every((r) => r.ok),
      detail: `${refs.filter((r) => r.ok).length}/${refs.length}`,
    },
    {
      name: `clean set exact >= ${CLEAN_EXACT_TARGET * 100}%`,
      pass: cleanExactRate >= CLEAN_EXACT_TARGET,
      detail: `${exactOf(clean)}/${clean.length} = ${(cleanExactRate * 100).toFixed(1)}%`,
    },
    {
      name: `clean set step-span accuracy >= ${CLEAN_SPAN_TARGET * 100}%`,
      pass: spanRate >= CLEAN_SPAN_TARGET,
      detail: `${stepsRight}/${stepsTotal} = ${(spanRate * 100).toFixed(1)}%`,
    },
    {
      name: 'confident-wrong fixtures (wrong structure at >= 0.70) = 0',
      pass: confidentWrong.length === 0,
      detail: String(confidentWrong.length),
    },
    {
      name: 'negatives end as list/none with confidence < 0.70',
      pass: neg.every((r) => r.ok),
      detail: `${neg.filter((r) => r.ok).length}/${neg.length}`,
    },
  ];

  return {
    rows,
    references: { total: refs.length, ok: refs.filter((r) => r.ok).length },
    clean: { total: clean.length, exact: exactOf(clean), stepsRight, stepsTotal },
    hard: {
      total: hard.length,
      structured: hard.filter((r) => r.match !== 'n/a').length,
      exact: exactOf(hard),
      wrong: hardWrong.length,
      wrongBelowHigh: hardWrong.filter((r) => (r.confidence ?? 0) < HIGH).length,
    },
    negatives: { total: neg.length, ok: neg.filter((r) => r.ok).length },
    confidentWrong,
    calibration,
    timing: {
      maxMs: times[times.length - 1] ?? 0,
      medianMs: times[Math.floor(times.length / 2)] ?? 0,
    },
    fixtureCount: loadMapperFixtures().length,
    bytes: mapperFixtureBytes(),
    gates,
    pass: gates.every((g) => g.pass),
  };
}

// -- printing ---------------------------------------------------------------------------

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

export function printMapperReport(report: MapperReport): void {
  console.log(
    '\nAuto-mapper accuracy (offline: hand-written fixtures and sample-derived references)',
  );
  console.log(
    'Definitions: "structure" = section titles, row order by normalized name, split groups and\n' +
      'portion labels, and per step kind, row_start, row_end (labels and temp/time are not compared\n' +
      'except where a fixture states them). EXACT = every part equal. view: grid when confidence\n' +
      '>= 0.70, list below that, none when no proposal. Thresholds: high >= 0.70, medium 0.40-0.69,\n' +
      'low < 0.40. Fixtures are self-written; this does not measure real sites.\n',
  );
  console.log(
    `${pad('fixture', 42)} ${pad('class', 9)} ${pad('want', 5)} ${pad('got', 5)} ${pad('conf', 5)} ${pad('level', 6)} ${pad('structure', 16)} warnings`,
  );
  for (const r of report.rows) {
    const structure = r.match === 'PARTIAL' ? `PARTIAL ${r.stepsRight}/${r.stepsTotal}` : r.match;
    console.log(
      `${pad(r.name, 42)} ${pad(r.cls, 9)} ${pad(r.expectView, 5)} ${pad(r.gotView, 5)} ${pad(
        r.confidence === null ? '-' : r.confidence.toFixed(2),
        5,
      )} ${pad(r.level, 6)} ${pad(structure, 16)} ${r.warnings.join(', ')}${r.ok ? '' : `   <-- ${r.problems.join('; ')}`}`,
    );
  }
  const { clean, hard, references, negatives } = report;
  console.log(
    `\n1. Reference set: ${references.ok}/${references.total} exact with confidence >= 0.70`,
  );
  console.log(
    `2. Clean set: ${clean.exact}/${clean.total} exact (${((clean.exact / (clean.total || 1)) * 100).toFixed(1)}%), step-span accuracy ${clean.stepsRight}/${clean.stepsTotal} (${((clean.stepsRight / (clean.stepsTotal || 1)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `3. Hard set (informational, ${hard.total} fixtures, ${hard.structured} with an expected structure): ${hard.exact}/${hard.structured} exact; of ${hard.wrong} that differ, ${hard.wrongBelowHigh} scored below 0.70`,
  );
  console.log(
    `4. Confident-wrong count: ${report.confidentWrong.length}${report.confidentWrong.length ? ' (' + report.confidentWrong.map((r) => r.name).join(', ') + ')' : ''}`,
  );
  console.log(`5. Negative set: ${negatives.ok}/${negatives.total} ended as list/none below 0.70`);
  console.log('6. Calibration (fixtures with an expected structure):');
  for (const c of report.calibration) {
    console.log(
      `   ${c.bucket}  fixtures ${pad(String(c.total), 3)} exact ${c.exact}${c.total ? ` (${((c.exact / c.total) * 100).toFixed(0)}%)` : ''}`,
    );
  }
  console.log(
    `7. Timing: max ${report.timing.maxMs.toFixed(2)} ms, median ${report.timing.medianMs.toFixed(2)} ms per fixture`,
  );
  console.log(
    `Mapper fixtures: ${report.fixtureCount} files, ${(report.bytes / 1024).toFixed(1)} KB, plus ${report.references.total} sample-derived references`,
  );
  console.log('\nGates:');
  for (const g of report.gates)
    console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${g.name}: ${g.detail}`);
}
