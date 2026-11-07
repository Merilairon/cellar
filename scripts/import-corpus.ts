import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Draft } from '@/lib/import/normalize';
import { ImportError } from '@/lib/import/errors';
import type { Headless } from '@/lib/import/headless-client';
import { runImport } from '@/lib/import/pipeline';

// Fixture corpus runner (spec req 14, data-model G9/G11). Offline: runImport gets a fake
// safeFetch that serves the fixture HTML, so nothing touches the network. No db, no fs
// outside the fixture folder.

export const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'import');
export const TARGET = 0.85;

export type Expectation = {
  expect: 'draft' | 'no_recipe' | 'out_of_slice';
  kind: string;
  title?: string;
  min_ingredients?: number;
  min_steps?: number;
  /** Substrings that must not appear anywhere in the serialized draft (sanitizer checks). */
  forbid?: string[];
  /** `null`: the draft must have no cover image. */
  cover_image?: null;
  /** `paste`: the fixture is `name.txt` and goes through the paste path (default: `name.html`, URL path). */
  input?: 'paste';
  /** Checks on the auto-mapper proposal attached by the pipeline (3b). */
  map?: MapExpectation;
  carry?: string;
  note?: string;
  /** Static fetch answers this status (401/403/429 become `blocked`); the body is the .html file. */
  raw_status?: number;
  /**
   * What a headless render of the page yields. The rendered DOM is self-written
   * (`<name>.rendered.html`); with the sidecar off it is never read. Only used by the
   * fake sidecar, never a real browser.
   */
  headless?: HeadlessExpectation;
};

export type HeadlessExpectation = {
  render: string;
  expect: 'draft' | 'no_recipe';
  title?: string;
  min_ingredients?: number;
  min_steps?: number;
};

export type MapExpectation = {
  /** Section titles of `draft.mapping.sections`, in order. */
  section_titles?: Array<string | null>;
  min_confidence?: number;
  max_confidence?: number;
  /** `none`: the draft must carry no proposal. */
  level?: 'high' | 'medium' | 'low' | 'none';
  warnings_include?: string[];
};

export type Row = {
  name: string;
  kind: string;
  expect: Expectation['expect'];
  got: 'draft' | 'no_recipe' | 'error';
  pass: boolean;
  reason: string;
};

export type Report = {
  rows: Row[];
  /** Fixtures with expect = 'draft'. */
  draftTotal: number;
  draftPassed: number;
  rate: number;
  /** Valid drafts / all recipe pages (draft + out-of-slice), the stricter reading of the spec. */
  overallRate: number;
  outOfSlice: Row[];
  /** Fixtures that deliberately yield no recipe (paywalled, non-recipe, malformed). */
  negatives: Row[];
  failures: Row[];
  bytes: number;
};

function checkMap(exp: MapExpectation, m: Draft['mapping'], pageWarnings: string[]): string[] {
  const problems: string[] = [];
  if (exp.level === 'none') {
    if (m !== null) problems.push('expected no mapping');
    return problems;
  }
  if (!m) return [`expected a mapping, got none (${pageWarnings.join(',') || 'no warning'})`];
  if (exp.level !== undefined && m.level !== exp.level)
    problems.push(`level ${m.level} != ${exp.level}`);
  if (exp.min_confidence !== undefined && m.confidence < exp.min_confidence)
    problems.push(`confidence ${m.confidence} < ${exp.min_confidence}`);
  if (exp.max_confidence !== undefined && m.confidence > exp.max_confidence)
    problems.push(`confidence ${m.confidence} > ${exp.max_confidence}`);
  if (exp.section_titles !== undefined) {
    const got = JSON.stringify(m.sections.map((s) => s.title ?? null));
    if (got !== JSON.stringify(exp.section_titles))
      problems.push(`section titles ${got} != ${JSON.stringify(exp.section_titles)}`);
  }
  for (const w of exp.warnings_include ?? [])
    if (!m.warnings.includes(w as never)) problems.push(`mapping warning missing: ${w}`);
  return problems;
}

function check(
  exp: Expectation,
  r: Awaited<ReturnType<typeof runImport>>,
  rawError = 'no_recipe',
): string[] {
  const problems: string[] = [];
  const got = r.status === 'needs_review' && r.draft ? 'draft' : 'no_recipe';
  if (exp.expect === 'draft') {
    if (got !== 'draft' || !r.draft) return [`expected a draft, got ${r.error_code ?? 'none'}`];
    const d = r.draft;
    const ings = d.sections.reduce((n, s) => n + s.ingredients.length, 0);
    const steps = d.sections.reduce((n, s) => n + s.steps.length, 0);
    if (exp.title !== undefined && d.title !== exp.title)
      problems.push(`title "${d.title}" != "${exp.title}"`);
    if (exp.min_ingredients !== undefined && ings < exp.min_ingredients)
      problems.push(`${ings} ingredients < ${exp.min_ingredients}`);
    if (exp.min_steps !== undefined && steps < exp.min_steps)
      problems.push(`${steps} steps < ${exp.min_steps}`);
    const blob = JSON.stringify(d).toLowerCase();
    for (const f of exp.forbid ?? [])
      if (blob.includes(f.toLowerCase())) problems.push(`unsanitized: found "${f}"`);
    if (exp.cover_image === null && d.cover_image_url !== null)
      problems.push(`cover image kept: ${d.cover_image_url}`);
    if (exp.map) problems.push(...checkMap(exp.map, d.mapping, r.warnings));
  } else if (got !== 'no_recipe' || r.error_code !== rawError) {
    problems.push(`expected ${rawError}, got ${r.error_code ?? got}`);
  }
  return problems;
}

export type CorpusOptions = {
  /**
   * Simulate an enabled sidecar with a fake client that serves `<name>.rendered.html`
   * (the raw page for fixtures without one). No browser, no network. Default: off.
   */
  headless?: boolean;
};

export async function runCorpus(dir = FIXTURE_DIR, opts: CorpusOptions = {}): Promise<Report> {
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.expected.json'))
    .map((f) => f.replace(/\.expected\.json$/, ''))
    .sort();
  const rows: Row[] = [];
  let bytes = 0;
  for (const name of names) {
    const exp = JSON.parse(readFileSync(join(dir, `${name}.expected.json`), 'utf8')) as Expectation;
    const paste = exp.input === 'paste';
    const html = readFileSync(join(dir, `${name}.${paste ? 'txt' : 'html'}`));
    bytes += html.length;
    const fakeFetch = async (url: string) => {
      if (exp.raw_status !== undefined && exp.raw_status >= 400) {
        if ([401, 403, 429].includes(exp.raw_status)) throw new ImportError('blocked');
        throw new ImportError('fetch_failed');
      }
      return rawPage(url);
    };
    const rawPage = (url: string) => ({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: new Uint8Array(html),
      finalUrl: url,
    });
    // Effective expectation: with the fake sidecar on, a fixture with a `headless` block is
    // judged on what the rendered page yields; all others keep their label (a sidecar
    // rendering a static page returns the same DOM).
    const h = opts.headless ? exp.headless : undefined;
    const eff: Expectation = h ? { ...exp, ...h, expect: h.expect } : exp;
    let headless: Headless | undefined;
    if (opts.headless) {
      const rendered = h ? readFileSync(join(dir, h.render)) : html;
      if (h) bytes += rendered.length;
      headless = {
        enabled: true,
        render: async (url) => ({
          html: rendered.toString('utf8'),
          finalUrl: url,
          status: 200,
        }),
      };
    }
    let row: Row;
    try {
      const r = await runImport(
        paste ? { text: html.toString('utf8') } : { url: `https://fixtures.example.com/${name}` },
        { safeFetch: fakeFetch, headless },
      );
      const problems = check(
        eff,
        r,
        exp.raw_status !== undefined && !h && [401, 403, 429].includes(exp.raw_status)
          ? 'blocked'
          : 'no_recipe',
      );
      row = {
        name,
        kind: exp.kind,
        expect: eff.expect,
        got: r.status === 'needs_review' && r.draft ? 'draft' : 'no_recipe',
        pass: problems.length === 0,
        reason: problems.join('; '),
      };
    } catch (e) {
      row = {
        name,
        kind: exp.kind,
        expect: eff.expect,
        got: 'error',
        pass: false,
        reason: `threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    rows.push(row);
  }
  const drafts = rows.filter((r) => r.expect === 'draft');
  const draftPassed = drafts.filter((r) => r.pass).length;
  const recipePages = drafts.length + rows.filter((r) => r.expect === 'out_of_slice').length;
  return {
    rows,
    draftTotal: drafts.length,
    draftPassed,
    rate: drafts.length ? draftPassed / drafts.length : 0,
    overallRate: recipePages ? draftPassed / recipePages : 0,
    outOfSlice: rows.filter((r) => r.expect === 'out_of_slice'),
    negatives: rows.filter((r) => r.expect === 'no_recipe'),
    failures: rows.filter((r) => !r.pass),
    bytes,
  };
}

export type HeadlessReport = {
  /** Sidecar off (the default and the number that counts). */
  off: Report;
  /** Sidecar simulated by the fake client. NOT a measurement of a real browser. */
  on: Report;
  /** Out-of-slice fixtures that become valid drafts with the fake sidecar. */
  recovered: Row[];
  /** Still out of slice with the sidecar on (none today; microdata moved to draft in 04a T13). */
  stillOut: Row[];
  /** Rendered page is still blocked, paywalled or not a recipe: correctly rejected. */
  stillRejected: Row[];
  /** Fixtures that fail (or are out of slice) when the sidecar is off but have a render. */
  needSidecar: string[];
};

export async function runHeadlessCorpus(dir = FIXTURE_DIR): Promise<HeadlessReport> {
  const off = await runCorpus(dir);
  const on = await runCorpus(dir, { headless: true });
  const withRender = new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith('.expected.json'))
      .map((f) => f.replace(/\.expected\.json$/, ''))
      .filter(
        (n) =>
          !!(JSON.parse(readFileSync(join(dir, `${n}.expected.json`), 'utf8')) as Expectation)
            .headless,
      ),
  );
  const offByName = new Map(off.rows.map((r) => [r.name, r]));
  const recovered = on.rows.filter(
    (r) => offByName.get(r.name)?.expect === 'out_of_slice' && r.expect === 'draft' && r.pass,
  );
  const stillRejected = on.rows.filter(
    (r) => withRender.has(r.name) && r.expect === 'no_recipe' && r.pass,
  );
  return {
    off,
    on,
    recovered,
    stillOut: on.rows.filter((r) => r.expect === 'out_of_slice'),
    stillRejected,
    needSidecar: [...withRender].sort(),
  };
}
