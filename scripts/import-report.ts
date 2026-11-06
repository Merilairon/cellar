import { runCorpus, runHeadlessCorpus, TARGET, type Row } from './import-corpus';
import { printMapperReport, runMapperCorpus } from './mapper-corpus';

// Usage: npm run test:import. Prints the corpus report and the auto-mapper accuracy report;
// exits 1 below the 85 percent target or when a mapper gate fails.

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
    `Overall (all recipe pages incl. out-of-slice): ${report.draftPassed}/${report.draftTotal + report.outOfSlice.length} valid drafts = ${(report.overallRate * 100).toFixed(1)}%`,
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
  const hl = await runHeadlessCorpus();
  console.log('\nHeadless (sidecar) section');
  console.log(
    'The numbers above are with the sidecar OFF (HEADLESS_URL unset) and are the ones that count.\n' +
      'Below, a FAKE sidecar serves self-written rendered pages (no browser, no network): it proves\n' +
      'the static -> headless chain and the fixtures, not real-site recovery. The real-browser check\n' +
      'is the T13 browser job and the manual real-site run.',
  );
  console.log(
    `Headless disabled: ${hl.off.outOfSlice.length} out-of-slice fixtures fail as before ` +
      `(${hl.needSidecar.length} fixtures have a rendered variant and need the sidecar; ` +
      `rate unchanged at ${(hl.off.rate * 100).toFixed(1)}%)`,
  );
  console.log(`Recovered with the fake sidecar (${hl.recovered.length}):`);
  for (const r of hl.recovered) console.log(`  + ${r.name}: ${r.kind}`);
  console.log(`Still rejected after render, correctly (${hl.stillRejected.length}):`);
  for (const r of hl.stillRejected) console.log(`  = ${r.name}: ${r.kind}`);
  console.log(`Stay out of slice with the sidecar on (${hl.stillOut.length}):`);
  for (const r of hl.stillOut) console.log(`  - ${r.name}: ${r.kind}`);
  console.log(
    `With the fake sidecar: ${hl.on.draftPassed}/${hl.on.draftTotal + hl.on.outOfSlice.length} recipe pages are valid drafts = ` +
      `${(hl.on.overallRate * 100).toFixed(1)}% overall (simulated; ${(hl.off.overallRate * 100).toFixed(1)}% with the sidecar off). ` +
      `The static-handleable rate is ${(hl.on.rate * 100).toFixed(1)}% vs ${(hl.off.rate * 100).toFixed(1)}%.`,
  );
  if (hl.on.failures.length) {
    console.log(`Headless-on failures (${hl.on.failures.length}):`);
    for (const r of hl.on.failures) console.log(`  ${r.name}: ${r.reason}`);
  }
  const mapper = runMapperCorpus();
  printMapperReport(mapper);
  const importOk =
    report.rate >= TARGET &&
    report.failures.filter((r) => r.expect !== 'draft').length === 0 &&
    hl.on.failures.length === 0 &&
    hl.on.overallRate > report.overallRate;
  process.exit(importOk && mapper.pass ? 0 : 1);
}

void main();
