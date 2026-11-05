import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from './connection';
import { invite, user } from './schema';
import type { User } from './users';

export type Invite = typeof invite.$inferSelect;

export function insertInvite(
  db: Db,
  row: { tokenHash: string; email: string | null; createdBy: string; expiresAt: string },
): void {
  db.insert(invite).values(row).run();
}

/** Unused, unexpired invite for a token hash (read-only check for rendering). */
export function findUsableInvite(db: Db, tokenHash: string, now: Date): Invite | undefined {
  return db
    .select()
    .from(invite)
    .where(
      and(
        eq(invite.tokenHash, tokenHash),
        isNull(invite.usedAt),
        gt(invite.expiresAt, now.toISOString()),
      ),
    )
    .get();
}

export type RegisterResult =
  { ok: true; user: User } | { ok: false; reason: 'invalid' | 'email_required' | 'email_taken' };

/**
 * Consume an invite and create the member in one BEGIN IMMEDIATE transaction:
 * concurrent submits of the same token yield exactly one user. The invite's email,
 * when set, wins over the submitted one.
 */
export function registerWithInvite(
  db: Db,
  input: {
    tokenHash: string;
    now: Date;
    email?: string;
    displayName: string;
    passwordHash: string;
  },
): RegisterResult {
  return db.transaction(
    (tx) => {
      const inv = tx
        .select()
        .from(invite)
        .where(
          and(
            eq(invite.tokenHash, input.tokenHash),
            isNull(invite.usedAt),
            gt(invite.expiresAt, input.now.toISOString()),
          ),
        )
        .get();
      if (!inv) return { ok: false, reason: 'invalid' } as const;
      const email = (inv.email ?? input.email)?.toLowerCase();
      if (!email) return { ok: false, reason: 'email_required' } as const;
      if (tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get()) {
        return { ok: false, reason: 'email_taken' } as const;
      }
      const created = tx
        .insert(user)
        .values({
          email,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          role: 'member',
        })
        .returning()
        .get();
      tx.update(invite).set({ usedAt: input.now.toISOString() }).where(eq(invite.id, inv.id)).run();
      return { ok: true, user: created } as const;
    },
    { behavior: 'immediate' },
  );
}
