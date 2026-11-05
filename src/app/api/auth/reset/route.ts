import { isCsrfSafe } from '@/lib/auth/csrf';
import { resetPasswordWithToken } from '@/lib/auth/resets';
import { resetSchema } from '@/lib/auth/schemas';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

const redirect = (path: string) =>
  new Response(null, { status: 303, headers: { Location: new URL(path, getEnv().BASE_URL).href } });

export async function POST(request: Request) {
  if (!isCsrfSafe(request.method, request.headers, getEnv().BASE_URL)) {
    return new Response(null, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const raw = Object.fromEntries(form ?? []);
  const parsed = resetSchema.safeParse(raw);
  const rawToken = typeof raw.token === 'string' ? raw.token : '';
  if (!parsed.success) {
    if (rawToken.length < 20 || rawToken.length > 100) return redirect('/reset/invalid');
    return redirect(`/reset/${encodeURIComponent(rawToken)}?error=password`);
  }
  const ok = await resetPasswordWithToken(getDb(), parsed.data.token, parsed.data.password);
  if (!ok) return redirect(`/reset/${encodeURIComponent(parsed.data.token)}`); // renders 404
  return redirect('/login?passwordChanged=1');
}
