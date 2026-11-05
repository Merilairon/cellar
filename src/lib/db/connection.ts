import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Open a SQLite database (":memory:" allowed) with WAL and foreign keys on. */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    const abs = resolve(path);
    mkdirSync(dirname(abs), { recursive: true });
    path = abs;
  }
  const client = new Database(path);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  client.pragma('busy_timeout = 5000');
  return drizzle(client, { schema });
}
