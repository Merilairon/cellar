import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { listHref, type ListFilters } from './search-url';

/** Result count in a polite live region, plus the "no results" state when filtered. */
export function ResultsStatus({ count, filters }: { count: number; filters: ListFilters }) {
  const t = useTranslations();
  const filtered = Boolean(filters.q || filters.tag || filters.author);
  return (
    <>
      <p
        role="status"
        aria-live="polite"
        className="mt-4 text-sm text-neutral-700 dark:text-neutral-300"
      >
        {filtered ? t('search.count', { count }) : ''}
      </p>
      {filtered && count === 0 && (
        <section className="mt-4 rounded border border-dashed border-neutral-400 p-6 text-center">
          <h2 className="text-lg font-semibold">{t('search.noResultsTitle')}</h2>
          <p className="mt-1 text-neutral-700 dark:text-neutral-300">
            {filters.q ? t('search.noResultsQuery', { q: filters.q }) : t('search.noResults')}
          </p>
          <Link href={listHref({})} className="mt-4 inline-flex min-h-11 items-center underline">
            {t('search.clearFilters')}
          </Link>
        </section>
      )}
    </>
  );
}
