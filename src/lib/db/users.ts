import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Db } from './connection';
import { session, user } from './schema';

export type User = typeof user.$inferSelect;

export function countUsers(db: Db): number {
  return db.select({ n: count() }).from(user).get()?.n ?? 0;
}

export function getUserByEmail(db: Db, email: string): User | undefined {
  return db.select().from(user).where(eq(user.email, email.toLowerCase())).get();
}

export function getUserById(db: Db, id: string): User | undefined {
  return db.select().from(user).where(eq(user.id, id)).get();
}

/**
 * Create the first admin only if no users exist. Runs in a BEGIN IMMEDIATE
 * transaction so concurrent callers serialize; returns undefined if a user exists.
 */
export function createFirstAdmin(
  db: Db,
  input: { email: string; displayName: string; passwordHash: string },
): User | undefined {
  return db.transaction(
    (tx) => {
      if ((tx.select({ n: count() }).from(user).get()?.n ?? 0) > 0) return undefined;
      return tx
        .insert(user)
        .values({ ...input, email: input.email.toLowerCase(), role: 'admin' })
        .returning()
        .get();
    },
    { behavior: 'immediate' },
  );
}

export function listUsers(db: Db): User[] {
  return db.select().from(user).orderBy(asc(user.createdAt), asc(user.id)).all();
}

export type DeactivateResult = 'ok' | 'not_found' | 'already_deactivated' | 'last_admin';

/**
 * Deactivate a user and delete their sessions atomically. Refuses (inside the same
 * BEGIN IMMEDIATE transaction, so it is race-safe) if the target is the last active admin.
 */
export function deactivateUserGuarded(
  db: Db,
  id: string,
  now: Date = new Date(),
): DeactivateResult {
  return db.transaction(
    (tx) => {
      const target = tx.select().from(user).where(eq(user.id, id)).get();
      if (!target) return 'not_found';
      if (target.deactivatedAt) return 'already_deactivated';
      if (target.role === 'admin') {
        const admins =
          tx
            .select({ n: count() })
            .from(user)
            .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)))
            .get()?.n ?? 0;
        if (admins <= 1) return 'last_admin';
      }
      tx.update(user).set({ deactivatedAt: now.toISOString() }).where(eq(user.id, id)).run();
      tx.delete(session).where(eq(session.userId, id)).run();
      return 'ok';
    },
    { behavior: 'immediate' },
  );
}
