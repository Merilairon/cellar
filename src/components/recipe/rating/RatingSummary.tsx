import { useFormatter, useTranslations } from 'next-intl';
import { OneStar, StarRow } from './Stars';

function useAvg() {
  const format = useFormatter();
  return (avg: number) =>
    format.number(avg, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Recipe page: "4.3 from 5 ratings" as one text node, with a decorative star row. */
export function RatingSummary({ avg, count }: { avg: number | null; count: number }) {
  const t = useTranslations();
  const fmt = useAvg();
  return (
    <p className="flex flex-wrap items-center gap-2">
      <StarRow avg={count > 0 ? avg : null} />
      <span>
        {count > 0 && avg !== null
          ? t('rating.summary.some', { avg: fmt(avg), count })
          : t('rating.summary.none')}
      </span>
    </p>
  );
}

/** Card line under the title: star + "4.3" + "(5)", or muted "Not rated yet". */
export function CardRating({ avg, count }: { avg: number | null; count: number }) {
  const t = useTranslations();
  const fmt = useAvg();
  if (count === 0 || avg === null) {
    return (
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{t('rating.card.none')}</p>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-1 text-sm">
      <span className="sr-only">{t('rating.card.label', { avg: fmt(avg), count })}</span>
      <OneStar />
      <span aria-hidden="true">{fmt(avg)}</span>
      <span aria-hidden="true" className="text-neutral-700 dark:text-neutral-300">
        ({count})
      </span>
    </p>
  );
}
