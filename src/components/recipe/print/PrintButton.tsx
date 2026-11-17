'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { btn } from '../styles';

/**
 * Print (UX spec 4.2): a real button that opens the browser's print dialog. The landscape hint is
 * always its accessible description and is also shown beside it from 640px up (phones print
 * through a share sheet where orientation is chosen later). Hidden on paper.
 */
export function PrintButton() {
  const t = useTranslations();
  const hintId = useId();
  return (
    <span className="inline-flex flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        className={btn}
        aria-describedby={hintId}
        onClick={() => window.print()}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          focusable="false"
          className="mr-2"
        >
          <path
            d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        {t('print.open')}
      </button>
      {/* Not display:none below 640px: the description must stay reachable (sr-only). */}
      <span
        id={hintId}
        className="sr-only sm:not-sr-only text-sm text-neutral-700 dark:text-neutral-300"
      >
        {t('print.hint')}
      </span>
    </span>
  );
}
