import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { lookupInvite } from '@/lib/auth/invites';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  email: 'register.errors.email',
  email_required: 'register.errors.email',
  displayName: 'register.errors.displayName',
  password: 'register.errors.password',
  email_taken: 'register.errors.emailTaken',
  csrf: 'register.errors.csrf',
};

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations();
  const { token } = await params;
  const { error } = await searchParams;
  // Invalid, expired and used tokens are indistinguishable: same 404 page.
  const inv = lookupInvite(getDb(), token);
  if (!inv) notFound();
  const msg = error && ERRORS[error] ? t(ERRORS[error]) : null;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-2xl font-bold">{t('register.title')}</h1>
      {msg && (
        <p role="alert" className="mb-4 text-red-600">
          {msg}
        </p>
      )}
      <form method="post" action="/api/auth/register" className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        {inv.email ? (
          <p>{inv.email}</p>
        ) : (
          <label className="flex flex-col gap-1">
            {t('register.email')}
            <input name="email" type="email" required autoComplete="email" className="border p-2" />
          </label>
        )}
        <label className="flex flex-col gap-1">
          {t('register.displayName')}
          <input name="displayName" required maxLength={80} className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          {t('register.password')}
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            className="border p-2"
          />
        </label>
        <button type="submit" className="bg-emerald-600 p-2 text-white">
          {t('register.submit')}
        </button>
      </form>
    </main>
  );
}
