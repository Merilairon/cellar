import { getTranslations } from 'next-intl/server';

/** Generic 404 for every notFound() (bad invite/reset token, closed setup, unknown path). */
export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-sm p-8">
      <p>{t('common.invalidLink')}</p>
    </main>
  );
}
