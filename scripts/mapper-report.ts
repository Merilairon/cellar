import { printMapperReport, runMapperCorpus } from './mapper-corpus';

// Usage: npm run test:mapper. Prints the auto-mapper accuracy report; exits 1 when a gate fails.

const report = runMapperCorpus();
printMapperReport(report);
process.exit(report.pass ? 0 : 1);
