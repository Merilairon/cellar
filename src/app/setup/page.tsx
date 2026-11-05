import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { countUsers } from '@/lib/db/users';
import { t } from '@/lib/messages';

export const dynamic = 'force-dynamic';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (countUsers(getDb()) > 0) notFound();
  const { error } = await searchParams;
  const msg =
    error && ['email', 'displayName', 'password'].includes(error)
      ? t(`setup.errors.${error}`)
      : null;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-2xl font-bold">{t('setup.title')}</h1>
      {msg && (
        <p role="alert" className="mb-4 text-red-600">
          {msg}
        </p>
      )}
      <form method="post" action="/api/setup" className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          {t('setup.email')}
          <input name="email" type="email" required autoComplete="email" className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          {t('setup.displayName')}
          <input name="displayName" required maxLength={80} className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          {t('setup.password')}
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
          {t('setup.submit')}
        </button>
      </form>
    </main>
  );
}
