import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFoundMetadata } from '@/lib/page-meta';

export const generateMetadata = notFoundMetadata;

/** Generic 404 for every notFound() (bad invite/reset token, closed setup, unknown path). */
export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-2 text-2xl font-bold">{t('meta.notFound')}</h1>
      <p>{t('common.invalidLink')}</p>
      <p className="mt-4">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-emerald-800 underline dark:text-emerald-300"
        >
          {t('common.goHome')}
        </Link>
      </p>
    </main>
  );
}
