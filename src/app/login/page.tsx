import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { countUsers } from '@/lib/db/users';
import { t } from '@/lib/messages';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (countUsers(getDb()) === 0) redirect('/setup');
  if (await getCurrentUser()) redirect('/');
  const { error } = await searchParams;
  const msg = error === 'csrf' ? t('login.errors.csrf') : error ? t('login.errors.invalid') : null;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-2xl font-bold">{t('login.title')}</h1>
      {msg && (
        <p role="alert" className="mb-4 text-red-600">
          {msg}
        </p>
      )}
      <form method="post" action="/api/auth/login" className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          {t('login.email')}
          <input name="email" type="email" required autoComplete="email" className="border p-2" />
        </label>
        <label className="flex flex-col gap-1">
          {t('login.password')}
          <input
            name="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            className="border p-2"
          />
        </label>
        <button type="submit" className="bg-emerald-600 p-2 text-white">
          {t('login.submit')}
        </button>
      </form>
    </main>
  );
}
