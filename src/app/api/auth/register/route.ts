import { isCsrfSafe } from '@/lib/auth/csrf';
import { registerWithToken } from '@/lib/auth/invites';
import { registerSchema } from '@/lib/auth/schemas';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { authLimiters, getClientIp, limitClientOrResponse } from '@/lib/security/auth-limits';

export const dynamic = 'force-dynamic';

const redirect = (path: string) =>
  new Response(null, { status: 303, headers: { Location: new URL(path, getEnv().BASE_URL).href } });

export async function POST(request: Request) {
  if (!isCsrfSafe(request.method, request.headers, getEnv().BASE_URL)) {
    return new Response(null, { status: 403 });
  }
  const blocked = await limitClientOrResponse(
    authLimiters().register,
    getClientIp(request.headers),
  );
  if (blocked) return blocked;
  const form = await request.formData().catch(() => null);
  const raw = Object.fromEntries(form ?? []);
  const parsed = registerSchema.safeParse(raw);
  const rawToken = typeof raw.token === 'string' ? raw.token : '';
  if (!parsed.success) {
    // Token not well-formed: same generic 404 page as any bad token.
    if (rawToken.length < 20 || rawToken.length > 100) return redirect('/register/invalid');
    const field = String(parsed.error.issues[0]?.path[0] ?? 'email');
    return redirect(`/register/${encodeURIComponent(rawToken)}?error=${encodeURIComponent(field)}`);
  }
  const { token, ...input } = parsed.data;
  const result = await registerWithToken(getDb(), token, input);
  if (!result.ok) {
    if (result.reason === 'invalid') return redirect(`/register/${encodeURIComponent(token)}`);
    return redirect(`/register/${encodeURIComponent(token)}?error=${result.reason}`);
  }
  return redirect('/login?registered=1');
}
