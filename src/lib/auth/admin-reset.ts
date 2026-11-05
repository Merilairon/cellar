import type { Db } from '@/lib/db/connection';
import { getUserByEmail } from '@/lib/db/users';
import { issuePasswordReset } from './resets';

export type AdminResetResult =
  | { ok: true; link: string; expiresAt: Date }
  | { ok: false; reason: 'invalid_email' | 'not_found' | 'deactivated' };

/**
 * CLI recovery core (pure, no next/*). Issues a one-time reset link with
 * `created_by = null` via the same mechanism as the admin UI. Never reactivates
 * a deactivated account.
 */
export function adminResetByEmail(
  db: Db,
  email: string,
  baseUrl: string,
  now: Date = new Date(),
): AdminResetResult {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'invalid_email' };
  const target = getUserByEmail(db, normalized);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.deactivatedAt) return { ok: false, reason: 'deactivated' };
  const res = issuePasswordReset(db, { userId: target.id, createdBy: null, baseUrl }, now);
  if (!res) return { ok: false, reason: 'deactivated' };
  return { ok: true, link: res.link, expiresAt: res.expiresAt };
}

const MESSAGES = {
  invalid_email: 'Usage: npm run admin:reset -- <email>',
  not_found: 'No user with that email.',
  deactivated: 'That account is deactivated; it will not be reactivated by this command.',
} as const;

/** Run the CLI; returns the process exit code and writes to the given streams. */
export function runAdminReset(
  db: Db,
  argv: string[],
  baseUrl: string,
  out: { log: (s: string) => void; error: (s: string) => void },
  now: Date = new Date(),
): number {
  const res = adminResetByEmail(db, argv[0] ?? '', baseUrl, now);
  if (!res.ok) {
    out.error(MESSAGES[res.reason]);
    return res.reason === 'invalid_email' ? 2 : 1;
  }
  out.log(res.link);
  out.log(`Single use, expires ${res.expiresAt.toISOString()}.`);
  return 0;
}
