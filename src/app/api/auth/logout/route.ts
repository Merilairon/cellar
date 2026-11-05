import { isCsrfSafe } from '@/lib/auth/csrf';
import { clearSessionCookie, readSessionCookie } from '@/lib/auth/cookies';
import { deleteSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isCsrfSafe(request.method, request.headers, getEnv().BASE_URL)) {
    return new Response(null, { status: 403 });
  }
  const token = await readSessionCookie();
  if (token) deleteSession(getDb(), token);
  await clearSessionCookie();
  return new Response(null, {
    status: 303,
    headers: { Location: new URL('/login', getEnv().BASE_URL).href },
  });
}
