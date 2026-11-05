import { getDb } from '@/lib/db';
import type { User } from '@/lib/db/users';
import { readSessionCookie } from './cookies';
import { validateSession } from './session';

/** Resolve the signed-in user from the cookie; null if absent, expired or deactivated. */
export async function getCurrentUser(): Promise<User | null> {
  const token = await readSessionCookie();
  return token ? validateSession(getDb(), token) : null;
}
