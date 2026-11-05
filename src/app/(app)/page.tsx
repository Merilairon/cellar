import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth/current-user';

export default async function Home() {
  const t = await getTranslations();
  const user = await getCurrentUser();
  return (
    <main>
      <h1 className="text-2xl font-bold">{t('common.home')}</h1>
      <p className="mt-2">{t('home.welcome', { name: user?.displayName ?? '' })}</p>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">{t('home.intro')}</p>
    </main>
  );
}
