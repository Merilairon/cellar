import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { btn } from '../styles';
import { STAR_PATH } from './Stars';

/**
 * The viewer's own rating as a native radio group: one tab stop, arrow keys move and select.
 * The value is also always written as text. Controlled: the parent saves and announces.
 */
export function StarRating({
  mine,
  onSelect,
  onClear,
  disabled = false,
}: {
  mine: number | null;
  onSelect: (stars: number) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const uid = useId();
  const labelId = `${uid}-label`;
  return (
    <div>
      <p id={labelId} className="font-semibold">
        {t('rating.group.label')}
      </p>
      <div className="flex flex-wrap items-center gap-x-3">
        <div role="radiogroup" aria-labelledby={labelId} className="md-stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="md-star"
              data-on={mine !== null && n <= mine ? 'true' : 'false'}
              aria-disabled={disabled || undefined}
            >
              <input
                type="radio"
                name={`rating-${uid}`}
                value={n}
                checked={mine === n}
                disabled={disabled}
                aria-label={t('rating.star', { n })}
                className="md-visually-hidden"
                onChange={() => onSelect(n)}
              />
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              >
                <path d={STAR_PATH} />
              </svg>
            </label>
          ))}
        </div>
        <span>{mine === null ? t('rating.none') : t('rating.yours', { n: mine })}</span>
        {mine !== null && (
          <button type="button" className={btn} disabled={disabled} onClick={onClear}>
            {t('rating.clear')}
          </button>
        )}
      </div>
    </div>
  );
}
