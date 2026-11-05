import { runAdminReset } from '@/lib/auth/admin-reset';
import { openDb } from '@/lib/db/connection';
import { parseEnv } from '@/lib/env';

// Thin CLI entry: container-exec only, no HTTP surface. No next/* imports.
let code: number;
try {
  const env = parseEnv(process.env);
  const db = openDb(env.DATABASE_PATH);
  try {
    code = runAdminReset(db, process.argv.slice(2), env.BASE_URL, console);
  } finally {
    db.$client.close();
  }
} catch (err) {
  console.error(`admin:reset failed: ${err instanceof Error ? err.message : String(err)}`);
  code = 1;
}
process.exit(code);
