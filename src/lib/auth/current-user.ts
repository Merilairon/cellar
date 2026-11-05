import { getDb } from '@/lib/db';
import type { User } from '@/lib/db/users';
import { readSessionCookie } from './cookies';
import { validateSession } from './session';

/** Resolve the signed-in user from the cookie; null if absent, expired or deactivated. */
export async function getCurrentUser(): Promise<User | null> {
  const token = await readSessionCookie();
  return token ? validateSession(getDb(), token) : null;
}

export type AdminCheck = { ok: true; user: User } | { ok: false; status: 401 | 403 };

/** Server-side admin gate for every admin page, action and endpoint. */
export async function requireAdmin(): Promise<AdminCheck> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'admin') return { ok: false, status: 403 };
  return { ok: true, user };
}
