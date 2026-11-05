import { randomBytes } from 'node:crypto';
import type { Db } from '@/lib/db/connection';
import {
  findUsableInvite,
  insertInvite,
  registerWithInvite,
  type RegisterResult,
} from '@/lib/db/invites';
import { hashPassword } from './password';
import { hashToken } from './session';

/** Pure (no next/*). Tokens are 256-bit random; only their SHA-256 is stored. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Create an invite; the plaintext link is returned once and never stored. */
export function createInvite(
  db: Db,
  input: { createdBy: string; email?: string; baseUrl: string },
  now: Date = new Date(),
): { link: string; expiresAt: Date } {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  insertInvite(db, {
    tokenHash: hashToken(token),
    email: input.email?.toLowerCase() ?? null,
    createdBy: input.createdBy,
    expiresAt: expiresAt.toISOString(),
  });
  return { link: `${input.baseUrl}/register/${token}`, expiresAt };
}

/** Read-only: the invite's pinned email (or null) if the token is usable, else undefined. */
export function lookupInvite(db: Db, token: string, now: Date = new Date()) {
  const inv = findUsableInvite(db, hashToken(token), now);
  return inv ? { email: inv.email } : undefined;
}

export async function registerWithToken(
  db: Db,
  token: string,
  input: { email?: string; displayName: string; password: string },
  now: Date = new Date(),
): Promise<RegisterResult> {
  const tokenHash = hashToken(token);
  if (!findUsableInvite(db, tokenHash, now)) return { ok: false, reason: 'invalid' };
  return registerWithInvite(db, {
    tokenHash,
    now,
    email: input.email,
    displayName: input.displayName,
    passwordHash: await hashPassword(input.password),
  });
}
