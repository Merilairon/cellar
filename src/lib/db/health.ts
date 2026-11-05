import { sql } from 'drizzle-orm';
import type { Db } from './connection';

/** Trivial liveness probe: true if the database answers a constant query. */
export function dbHealthy(db: Db): boolean {
  try {
    return db.get<{ ok: number }>(sql`select 1 as ok`)?.ok === 1;
  } catch {
    return false;
  }
}
