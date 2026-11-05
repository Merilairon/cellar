import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  carry?: string;
  note?: string;
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
  outOfSlice: Row[];
  /** Fixtures that deliberately yield no recipe (paywalled, non-recipe, malformed). */
  negatives: Row[];
  failures: Row[];
  bytes: number;
};

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
    const html = readFileSync(join(dir, `${name}.html`));
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
        { url: `https://fixtures.example.com/${name}` },
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
  return {
    rows,
    draftTotal: drafts.length,
    draftPassed,
    rate: drafts.length ? draftPassed / drafts.length : 0,
    outOfSlice: rows.filter((r) => r.expect === 'out_of_slice'),
    negatives: rows.filter((r) => r.expect === 'no_recipe'),
    failures: rows.filter((r) => !r.pass),
    bytes,
  };
}
