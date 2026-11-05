'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { safeHttpUrl } from '@/components/recipe/api';
import { RecipeForm } from '@/components/recipe/RecipeForm';
import { btn } from '@/components/recipe/styles';
import type { Draft } from '@/lib/import/normalize';
import { formFromDraft } from '@/lib/recipes/form-model';
import { warningMessage } from './warnings';

// Every imported value below (title, source, tags, warnings, duplicate title) is rendered as a
// plain React text node. Never inject HTML or render markdown here.

export function ReviewForm({
  jobId,
  draft,
  warnings,
  duplicate,
}: {
  jobId: string;
  draft: Draft;
  warnings: string[];
  duplicate: { recipe_id: string; title: string } | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [initial] = useState(() => formFromDraft(draft));
  const [includeCover, setIncludeCover] = useState(draft.cover_image_url !== null);
  const [dupOpen, setDupOpen] = useState(duplicate !== null);
  const sourceHref = safeHttpUrl(draft.source_url);
  const sourceText = draft.source_name || sourceHref;

  const header = (
    <>
      <p className="text-neutral-700 dark:text-neutral-300">{t('import.review.intro')}</p>
      {dupOpen && duplicate && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded border border-amber-700 p-3 text-amber-900 dark:border-amber-400 dark:text-amber-200"
        >
          <p>{t('import.review.duplicate', { title: duplicate.title })}</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/recipes/${duplicate.recipe_id}`} className={`${btn} underline`}>
              {t('import.review.duplicateLink')}
            </Link>
            <button type="button" className={btn} onClick={() => setDupOpen(false)}>
              {t('import.review.importAnyway')}
            </button>
          </div>
        </div>
      )}
      {sourceText && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('import.review.source', { name: sourceText })}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="rounded border border-neutral-500 p-3">
          <h2 className="font-semibold">{t('import.review.warnings')}</h2>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{warningMessage(t, w)}</li>
            ))}
          </ul>
        </div>
      )}
      {draft.cover_image_url && (
        <div>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={includeCover}
              onChange={(e) => setIncludeCover(e.target.checked)}
              className="size-5"
              aria-describedby="import-cover-note"
            />
            {t('import.review.includeCover')}
          </label>
          <p id="import-cover-note" className="text-sm text-neutral-700 dark:text-neutral-300">
            {t('import.review.coverNote')}
          </p>
        </div>
      )}
      {draft.tags.length > 0 && (
        <div>
          <h2 className="font-semibold">{t('import.review.tags')}</h2>
          <ul className="mt-1 flex flex-wrap gap-2">
            {draft.tags.map((tag) => (
              <li key={tag} className="rounded border border-neutral-500 px-2 py-0.5 text-sm">
                {tag}
              </li>
            ))}
          </ul>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            {t('import.review.tagsNote')}
          </p>
        </div>
      )}
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {t('import.review.attribution')}
      </p>
    </>
  );

  return (
    <RecipeForm
      initial={initial}
      header={header}
      target={{
        url: `/api/import/${jobId}/save`,
        method: 'POST',
        extra: { import_cover: includeCover && draft.cover_image_url !== null },
        redirect: (res) =>
          res.warnings?.includes('cover_failed')
            ? `/recipes/${res.id}?notice=cover_failed`
            : `/recipes/${res.id}`,
        saveLabel: t('import.review.save'),
        failedText: t('import.review.saveFailed'),
        cancelLabel: t('import.review.discard'),
        onCancel: () => router.push('/import'),
      }}
    />
  );
}
