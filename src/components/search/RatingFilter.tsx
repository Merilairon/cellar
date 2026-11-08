import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FILTER_OPTIONS } from '../recipe/rating/rating-format';
import { minRatingHref, type ListFilters } from './search-url';

const chip =
  'inline-flex min-h-11 items-center rounded-full border border-neutral-500 px-3 hover:bg-neutral-100 aria-[current=true]:border-emerald-800 aria-[current=true]:bg-emerald-700 aria-[current=true]:text-white dark:hover:bg-neutral-800';

/** Server-rendered "minimum rating" chips; the choice lives in `?min_rating=` so it is shareable. */
export function RatingFilter({ filters }: { filters: ListFilters }) {
  const t = useTranslations();
  const active = filters.minRating ? Number(filters.minRating) : undefined;
  return (
    <div role="group" aria-label={t('rating.filter.legend')} className="mt-4">
      <ul className="flex flex-wrap items-center gap-2">
        <li>
          <Link
            href={minRatingHref(filters, undefined)}
            aria-current={active === undefined ? 'true' : undefined}
            className={chip}
          >
            {t('rating.filter.any')}
          </Link>
        </li>
        {FILTER_OPTIONS.map((n) => (
          <li key={n}>
            <Link
              href={minRatingHref(filters, n)}
              aria-current={active === n ? 'true' : undefined}
              aria-label={t('rating.filter.optionLabel', { n })}
              className={chip}
            >
              {t('rating.filter.option', { n })}
            </Link>
          </li>
        ))}
        {active !== undefined && (
          <li>
            <Link
              href={minRatingHref(filters, undefined)}
              aria-label={t('rating.filter.remove')}
              className="inline-flex min-h-11 items-center gap-1 rounded border border-neutral-500 px-3 underline"
            >
              {t('rating.filter.chip', { n: active })}
              <span aria-hidden="true">×</span>
            </Link>
          </li>
        )}
      </ul>
      {active !== undefined && (
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {t('rating.filter.unratedHidden')}
        </p>
      )}
    </div>
  );
}
