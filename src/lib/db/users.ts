import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Db } from './connection';
import { recipe, session, user } from './schema';

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

export type DeleteResult = 'ok' | 'not_found' | 'last_admin' | 'invalid_reassign_target';

/**
 * Delete a user; sessions, invites and password resets cascade via foreign keys
 * (reset `created_by` is set to null). Refuses, race-safely in one BEGIN IMMEDIATE
 * transaction, to delete the last active admin or to reassign to a missing,
 * deactivated or same user. The user's recipes are handled in the same transaction,
 * before the user row goes (the owner_id FK on `recipe` is RESTRICT): `reassign` moves them to
 * the target, `delete` removes them (children cascade; copies made by others keep
 * existing with `copied_from_id = null`). Any refusal leaves everything untouched.
 */
export type RecipeDisposition = { recipes: 'delete' } | { recipes: 'reassign'; reassignTo: string };

export function deleteUserGuarded(db: Db, id: string, opts: RecipeDisposition): DeleteResult {
  return db.transaction(
    (tx) => {
      const target = tx.select().from(user).where(eq(user.id, id)).get();
      if (!target) return 'not_found';
      if (opts.recipes === 'reassign') {
        const to = tx.select().from(user).where(eq(user.id, opts.reassignTo)).get();
        if (!to || to.deactivatedAt || to.id === id) return 'invalid_reassign_target';
      }
      if (target.role === 'admin' && !target.deactivatedAt) {
        const admins =
          tx
            .select({ n: count() })
            .from(user)
            .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)))
            .get()?.n ?? 0;
        if (admins <= 1) return 'last_admin';
      }
      if (opts.recipes === 'reassign') {
        tx.update(recipe).set({ ownerId: opts.reassignTo }).where(eq(recipe.ownerId, id)).run();
      } else {
        tx.delete(recipe).where(eq(recipe.ownerId, id)).run();
      }
      tx.delete(session).where(eq(session.userId, id)).run();
      tx.delete(user).where(eq(user.id, id)).run();
      return 'ok';
    },
    { behavior: 'immediate' },
  );
}

export type UnitPref = User['unitPref'];

/** Set the user's unit preference; returns false if the user does not exist. */
export function setUnitPref(db: Db, id: string, unitPref: UnitPref): boolean {
  return (
    db.update(user).set({ unitPref }).where(eq(user.id, id)).returning({ id: user.id }).all()
      .length > 0
  );
}
