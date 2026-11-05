import { eq, lte } from 'drizzle-orm';
import type { Db } from './connection';
import { session, user } from './schema';

export function insertSession(db: Db, row: { id: string; userId: string; expiresAt: string }) {
  db.insert(session).values(row).run();
}

/** Session joined with its user, by hashed id. */
export function getSessionWithUser(db: Db, id: string) {
  return db
    .select({ session, user })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(eq(session.id, id))
    .get();
}

export function deleteSessionById(db: Db, id: string): void {
  db.delete(session).where(eq(session.id, id)).run();
}

export function deleteSessionsForUser(db: Db, userId: string): void {
  db.delete(session).where(eq(session.userId, userId)).run();
}

export function deleteExpiredSessions(db: Db, nowIsoStr: string): number {
  return db.delete(session).where(lte(session.expiresAt, nowIsoStr)).run().changes;
}
