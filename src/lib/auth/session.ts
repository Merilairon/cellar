import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '@/lib/db/connection';
import {
  deleteExpiredSessions,
  deleteSessionById,
  getSessionWithUser,
  insertSession,
} from '@/lib/db/sessions';
import type { User } from '@/lib/db/users';

/** Pure (no next/*): usable from the CLI too. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Create a session; returns the raw cookie token (only its SHA-256 is stored). */
export function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  insertSession(db, { id: hashToken(token), userId, expiresAt: expiresAt.toISOString() });
  return { token, expiresAt };
}

/** Resolve a raw token to its user; rejects unknown, expired (row removed) and deactivated. */
export function validateSession(db: Db, token: string, now: Date = new Date()): User | null {
  if (!token) return null;
  const id = hashToken(token);
  const row = getSessionWithUser(db, id);
  if (!row) return null;
  if (row.session.expiresAt <= now.toISOString()) {
    deleteSessionById(db, id);
    return null;
  }
  if (row.user.deactivatedAt) return null;
  return row.user;
}

export function deleteSession(db: Db, token: string): void {
  deleteSessionById(db, hashToken(token));
}

export const cleanupExpiredSessions = (db: Db, now: Date = new Date()): number =>
  deleteExpiredSessions(db, now.toISOString());
