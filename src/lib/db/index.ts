import { getEnv } from '@/lib/env';
import { openDb, type Db } from './connection';

export { openDb, type Db } from './connection';
export * as schema from './schema';

const globalForDb = globalThis as unknown as { __recipeBookDb?: Db };

/** Process-wide connection to `DATABASE_PATH` (default `/data/app.db`). */
export function getDb(): Db {
  return (globalForDb.__recipeBookDb ??= openDb(getEnv().DATABASE_PATH));
}
