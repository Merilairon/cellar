import { useTranslations } from 'next-intl';
import type { MappingLevel } from '@/lib/import/map-types';

// Icon shape + text label + colour: the level never rests on colour alone. The icons are
// decorative; the label is real text, so no aria-label is needed.

export const LEVEL_BOX: Record<MappingLevel, string> = {
  high: 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-200',
  medium:
    'border-amber-700 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-200',
  low: 'border-red-700 bg-red-50 text-red-900 dark:border-red-400 dark:bg-red-950 dark:text-red-200',
};

const ICON = {
  // check in circle
  high: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </>
  ),
  // triangle with exclamation
  medium: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  // circle with cross
  low: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
};

export function MappingBadge({ level }: { level: MappingLevel }) {
  const t = useTranslations();
  const label =
    level === 'high'
      ? t('import.review.mapping.level.high.label')
      : level === 'medium'
        ? t('import.review.mapping.level.medium.label')
        : t('import.review.mapping.level.low.label');
  const description =
    level === 'high'
      ? t('import.review.mapping.level.high.description')
      : level === 'medium'
        ? t('import.review.mapping.level.medium.description')
        : t('import.review.mapping.level.low.description');
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-2 font-semibold">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICON[level]}
        </svg>
        <span>{label}</span>
      </p>
      <p>{description}</p>
    </div>
  );
}
