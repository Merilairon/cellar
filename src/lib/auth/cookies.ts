import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

export const SESSION_COOKIE = 'rb_session';

/** Secure iff BASE_URL is https (G3). */
export function cookieOptions(baseUrl: string, expires: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: baseUrl.startsWith('https://'),
    path: '/',
    expires,
  };
}

export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(getEnv().BASE_URL, expires));
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', cookieOptions(getEnv().BASE_URL, new Date(0)));
}

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
