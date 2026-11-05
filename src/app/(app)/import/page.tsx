import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations();
  return (
    <main>
      <h1 className="text-2xl font-bold">{t('import.title')}</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">{t('import.intro')}</p>
    </main>
  );
}
