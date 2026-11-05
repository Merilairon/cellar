import { count, eq } from 'drizzle-orm';
import type { Db } from './connection';
import { user } from './schema';

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
