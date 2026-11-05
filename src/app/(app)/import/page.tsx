import { getTranslations } from 'next-intl/server';
import { ImportDialog } from '@/components/import/ImportDialog';

export default async function Page() {
  const t = await getTranslations();
  return (
    <main>
      <h1 className="text-2xl font-bold">{t('import.title')}</h1>
      <p className="mt-2 mb-4 max-w-3xl text-neutral-700 dark:text-neutral-300">
        {t('import.intro')}
      </p>
      <ImportDialog />
    </main>
  );
}
