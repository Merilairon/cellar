import type { Db } from '@/lib/db/connection';
import { consumePasswordReset, insertPasswordReset, isResetUsable } from '@/lib/db/password-resets';
import { getUserById } from '@/lib/db/users';
import { generateToken } from './invites';
import { hashPassword } from './password';
import { hashToken } from './session';

/** Pure (no next/*): usable from the CLI (T10d) too. */
export const RESET_TTL_MS = 60 * 60 * 1000;

/** Issue a one-time reset link for an active user; undefined if user is missing/deactivated. */
export function issuePasswordReset(
  db: Db,
  input: { userId: string; createdBy: string | null; baseUrl: string },
  now: Date = new Date(),
): { link: string; expiresAt: Date } | undefined {
  const target = getUserById(db, input.userId);
  if (!target || target.deactivatedAt) return undefined;
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  insertPasswordReset(
    db,
    {
      userId: target.id,
      tokenHash: hashToken(token),
      createdBy: input.createdBy,
      expiresAt: expiresAt.toISOString(),
    },
    now,
  );
  return { link: `${input.baseUrl}/reset/${token}`, expiresAt };
}

export const isResetTokenUsable = (db: Db, token: string, now: Date = new Date()): boolean =>
  isResetUsable(db, hashToken(token), now);

/** Single-use. Also revokes all of the user's sessions. */
export async function resetPasswordWithToken(
  db: Db,
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<boolean> {
  const tokenHash = hashToken(token);
  if (!isResetUsable(db, tokenHash, now)) return false;
  return consumePasswordReset(db, {
    tokenHash,
    now,
    passwordHash: await hashPassword(newPassword),
  });
}
