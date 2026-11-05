import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from './connection';
import { passwordReset, session, user } from './schema';

/** Store a new reset token hash; earlier unused resets for the user are voided. */
export function insertPasswordReset(
  db: Db,
  row: { userId: string; tokenHash: string; createdBy: string | null; expiresAt: string },
  now: Date,
): void {
  db.transaction(
    (tx) => {
      tx.update(passwordReset)
        .set({ usedAt: now.toISOString() })
        .where(and(eq(passwordReset.userId, row.userId), isNull(passwordReset.usedAt)))
        .run();
      tx.insert(passwordReset).values(row).run();
    },
    { behavior: 'immediate' },
  );
}

/** True if the hash maps to an unused, unexpired reset of an active user (read-only). */
export function isResetUsable(db: Db, tokenHash: string, now: Date): boolean {
  return !!db
    .select({ id: passwordReset.id })
    .from(passwordReset)
    .innerJoin(user, eq(user.id, passwordReset.userId))
    .where(
      and(
        eq(passwordReset.tokenHash, tokenHash),
        isNull(passwordReset.usedAt),
        gt(passwordReset.expiresAt, now.toISOString()),
        isNull(user.deactivatedAt),
      ),
    )
    .get();
}

/**
 * Single-use consume: sets the new password hash, marks the reset used and deletes the
 * user's sessions, atomically. Returns false for unknown, expired, used or deactivated.
 */
export function consumePasswordReset(
  db: Db,
  input: { tokenHash: string; now: Date; passwordHash: string },
): boolean {
  return db.transaction(
    (tx) => {
      const row = tx
        .select({ id: passwordReset.id, userId: passwordReset.userId })
        .from(passwordReset)
        .innerJoin(user, eq(user.id, passwordReset.userId))
        .where(
          and(
            eq(passwordReset.tokenHash, input.tokenHash),
            isNull(passwordReset.usedAt),
            gt(passwordReset.expiresAt, input.now.toISOString()),
            isNull(user.deactivatedAt),
          ),
        )
        .get();
      if (!row) return false;
      tx.update(passwordReset)
        .set({ usedAt: input.now.toISOString() })
        .where(eq(passwordReset.id, row.id))
        .run();
      tx.update(user)
        .set({ passwordHash: input.passwordHash })
        .where(eq(user.id, row.userId))
        .run();
      tx.delete(session).where(eq(session.userId, row.userId)).run();
      return true;
    },
    { behavior: 'immediate' },
  );
}
