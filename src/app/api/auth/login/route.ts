import { isCsrfSafe } from '@/lib/auth/csrf';
import { setSessionCookie } from '@/lib/auth/cookies';
import { verifyDummy, verifyPassword } from '@/lib/auth/password';
import { loginSchema } from '@/lib/auth/schemas';
import { createSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { getUserByEmail } from '@/lib/db/users';
import { getEnv } from '@/lib/env';
import { authLimiters, getClientIp, limitOrResponse } from '@/lib/security/auth-limits';

export const dynamic = 'force-dynamic';

const redirect = (path: string) =>
  new Response(null, { status: 303, headers: { Location: new URL(path, getEnv().BASE_URL).href } });

export async function POST(request: Request) {
  if (!isCsrfSafe(request.method, request.headers, getEnv().BASE_URL)) {
    return new Response(null, { status: 403 });
  }
  const limits = authLimiters();
  const blocked = await limitOrResponse(limits.loginIp, getClientIp(request.headers));
  if (blocked) return blocked;
  const form = await request.formData().catch(() => null);
  const parsed = loginSchema.safeParse(Object.fromEntries(form ?? []));
  if (!parsed.success) return redirect('/login?error=invalid');
  const emailKey = parsed.data.email.toLowerCase();
  const blockedEmail = await limitOrResponse(limits.loginEmail, emailKey);
  if (blockedEmail) return blockedEmail;

  const db = getDb();
  const found = getUserByEmail(db, parsed.data.email);
  // Same work and same error for unknown email, wrong password and deactivated user.
  const ok = found
    ? await verifyPassword(found.passwordHash, parsed.data.password)
    : (await verifyDummy(parsed.data.password), false);
  if (!found || !ok || found.deactivatedAt) return redirect('/login?error=invalid');

  limits.loginEmail.reset(emailKey);
  const { token, expiresAt } = createSession(db, found.id);
  await setSessionCookie(token, expiresAt);
  return redirect('/');
}
