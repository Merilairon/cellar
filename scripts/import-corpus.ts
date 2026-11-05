import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Draft } from '@/lib/import/normalize';
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

function check(exp: Expectation, r: Awaited<ReturnType<typeof runImport>>): string[] {
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
  } else if (got !== 'no_recipe' || r.error_code !== 'no_recipe') {
    problems.push(`expected no_recipe, got ${got}`);
  }
  return problems;
}

export async function runCorpus(dir = FIXTURE_DIR): Promise<Report> {
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
    const fakeFetch = async (url: string) => ({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: new Uint8Array(html),
      finalUrl: url,
    });
    let row: Row;
    try {
      const r = await runImport(
        paste ? { text: html.toString('utf8') } : { url: `https://fixtures.example.com/${name}` },
        { safeFetch: fakeFetch },
      );
      const problems = check(exp, r);
      row = {
        name,
        kind: exp.kind,
        expect: exp.expect,
        got: r.status === 'needs_review' && r.draft ? 'draft' : 'no_recipe',
        pass: problems.length === 0,
        reason: problems.join('; '),
      };
    } catch (e) {
      row = {
        name,
        kind: exp.kind,
        expect: exp.expect,
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
