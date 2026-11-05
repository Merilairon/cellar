import { runCorpus, TARGET, type Row } from './import-corpus';

// Usage: npm run test:import. Prints the corpus report; exits 1 below the 85 percent target.

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

async function main(): Promise<void> {
  const report = await runCorpus();
  const line = (r: Row) =>
    `${pad(r.name, 40)} ${pad(r.expect, 13)} ${pad(r.got, 10)} ${r.pass ? 'PASS' : 'FAIL'}  ${r.reason}`;

  console.log('Import fixture report (offline: runImport with a fake safeFetch, no network)');
  console.log(
    'Success rate definition: valid drafts / fixtures expected to produce a draft (static-handleable\n' +
      'pages with a Recipe in JSON-LD). JS-rendered-only and microdata-only pages are out of slice\n' +
      '(carried to 3c / 3b) and reported separately; they do not count for or against the rate.\n',
  );
  console.log(`${pad('fixture', 40)} ${pad('expected', 13)} ${pad('got', 10)} result  reason`);
  for (const r of report.rows) console.log(line(r));

  const pct = (report.rate * 100).toFixed(1);
  console.log(
    `\nStatic-handleable: ${report.draftPassed}/${report.draftTotal} valid drafts = ${pct}% (target ${TARGET * 100}%)`,
  );
  console.log(
    `Deliberate no-recipe (paywalled, non-recipe, malformed, incomplete): ${report.negatives.filter((r) => r.pass).length}/${report.negatives.length} correctly rejected`,
  );
  console.log(`Out of slice (reported separately, not in the rate): ${report.outOfSlice.length}`);
  for (const r of report.outOfSlice)
    console.log(`  - ${r.name}: ${r.kind} -> got ${r.got}${r.pass ? '' : ' (UNEXPECTED)'}`);
  console.log(
    `Total fixtures: ${report.rows.length}, corpus size ${(report.bytes / 1024).toFixed(1)} KB`,
  );
  if (report.failures.length) {
    console.log(`\nFailures (${report.failures.length}):`);
    for (const r of report.failures) console.log(`  ${r.name}: ${r.reason}`);
  }
  process.exit(
    report.rate >= TARGET && report.failures.filter((r) => r.expect !== 'draft').length === 0
      ? 0
      : 1,
  );
}

void main();
