import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isResetTokenUsable } from '@/lib/auth/resets';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations();
  const { token } = await params;
  const { error } = await searchParams;
  if (!isResetTokenUsable(getDb(), token)) notFound();
  const msg = error === 'password' ? t('reset.errors.password') : null;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-2xl font-bold">{t('reset.title')}</h1>
      {msg && (
        <p role="alert" className="mb-4 text-red-600">
          {msg}
        </p>
      )}
      <form method="post" action="/api/auth/reset" className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <label className="flex flex-col gap-1">
          {t('reset.password')}
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
          {t('reset.submit')}
        </button>
      </form>
    </main>
  );
}
