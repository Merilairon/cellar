import { notFound } from 'next/navigation';
import { hashPassword } from '@/lib/auth/password';
import { setupSchema } from '@/lib/auth/schemas';
import { isCsrfSafe } from '@/lib/auth/csrf';
import { getDb } from '@/lib/db';
import { countUsers, createFirstAdmin } from '@/lib/db/users';
import { getEnv } from '@/lib/env';
import { authLimiters, getClientIp, limitClientOrResponse } from '@/lib/security/auth-limits';

export const dynamic = 'force-dynamic';

const redirect = (path: string) =>
  new Response(null, { status: 303, headers: { Location: new URL(path, getEnv().BASE_URL).href } });

export async function POST(request: Request) {
  const db = getDb();
  if (countUsers(db) > 0) notFound();
  if (!isCsrfSafe(request.method, request.headers, getEnv().BASE_URL)) {
    return new Response(null, { status: 403 });
  }
  const blocked = await limitClientOrResponse(authLimiters().setup, getClientIp(request.headers));
  if (blocked) return blocked;
  const form = await request.formData().catch(() => null);
  const parsed = setupSchema.safeParse(Object.fromEntries(form ?? []));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? 'email');
    return redirect(`/setup?error=${encodeURIComponent(field)}`);
  }
  const { email, displayName, password } = parsed.data;
  const created = createFirstAdmin(db, {
    email,
    displayName,
    passwordHash: await hashPassword(password),
  });
  if (!created) notFound(); // lost the race: setup is closed now
  return redirect('/login');
}
