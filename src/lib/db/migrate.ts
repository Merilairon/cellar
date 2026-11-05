import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { Db } from './connection';

export const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

/** Apply pending migrations; already-applied ones are skipped (idempotent). */
export function runMigrations(db: Db, folder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder: folder });
}

/**
 * Verify the SQLite build has FTS5 (needed from M2). Creates and drops a
 * temporary virtual table; leaves nothing behind. Throws if unsupported.
 */
export function assertFts5Available(db: Db): void {
  try {
    db.$client.exec(
      'CREATE VIRTUAL TABLE temp.__fts5_probe USING fts5(x); DROP TABLE temp.__fts5_probe;',
    );
  } catch (err) {
    throw new Error(
      `SQLite FTS5 is not available in this better-sqlite3 build: ${(err as Error).message}`,
    );
  }
}
