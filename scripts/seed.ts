import { openDb } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { parseEnv } from '@/lib/env';
import { seedGuard, seedSamples } from '@/lib/recipes/seed';

// Dev/demo only: inserts the self-written sample recipes. No next/* imports.
// Usage: npm run seed [-- --user <email>] [--yes]
// In production it refuses unless --yes or SEED_CONFIRM=1 (it writes to the real database).
let code = 0;
try {
  const args = process.argv.slice(2);
  const i = args.indexOf('--user');
  const email = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && !email) throw new Error('--user needs an email address');
  const env = parseEnv(process.env);
  const refused = seedGuard({
    nodeEnv: process.env.NODE_ENV,
    args,
    confirmEnv: process.env.SEED_CONFIRM,
    databasePath: env.DATABASE_PATH,
  });
  if (refused) throw new Error(refused);
  const db = openDb(env.DATABASE_PATH);
  try {
    runMigrations(db);
    const result = seedSamples(db, email);
    if (!result.ok) {
      console.error(`seed failed: ${result.error}`);
      code = 1;
    } else {
      for (const t of result.created) console.log(`created: ${t} (owner ${result.owner.email})`);
      for (const t of result.skipped) console.log(`skipped (already exists): ${t}`);
    }
  } finally {
    db.$client.close();
  }
} catch (err) {
  console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
  code = 1;
}
process.exit(code);
