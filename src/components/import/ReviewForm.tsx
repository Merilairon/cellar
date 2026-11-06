'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { safeHttpUrl } from '@/components/recipe/api';
import { RecipeForm } from '@/components/recipe/RecipeForm';
import { btn } from '@/components/recipe/styles';
import type { Draft } from '@/lib/import/normalize';
import {
  formFromDraftMode,
  previewIssues,
  sectionsSignature,
  withSections,
  type FormState,
} from '@/lib/recipes/form-model';
import { MappingPanel } from './MappingPanel';
import { initialMapState, mapReducer, saveViewMode, type MapAction } from './mapping-state';
import { warningMessage } from './warnings';

// Every imported value below (title, source, tags, warnings, duplicate title) is rendered as a
// plain React text node. Never inject HTML or render markdown here.

export function ReviewForm({
  jobId,
  draft,
  warnings,
  duplicate,
  headless = false,
}: {
  jobId: string;
  draft: Draft;
  warnings: string[];
  duplicate: { recipe_id: string; title: string } | null;
  /** The page was rendered in a browser (method headless). */
  headless?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const mapping = draft.mapping?.version === 1 ? draft.mapping : null;
  const [mapState, dispatch] = useReducer(mapReducer, mapping, (m) =>
    initialMapState(m ? m.level : 'low'),
  );
  // `formInit` is what RecipeForm (re)mounts with; `current` follows every edit for the preview.
  const [formInit, setFormInit] = useState(() =>
    formFromDraftMode(draft, mapping && mapping.level === 'high' ? 'grid' : 'list'),
  );
  const [current, setCurrent] = useState<FormState>(formInit);
  const [loadedSig, setLoadedSig] = useState(() => sectionsSignature(formInit.sections));
  const [previewOpen, setPreviewOpen] = useState(true);
  const [saveInvalid, setSaveInvalid] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  const edited = sectionsSignature(current.sections) !== loadedSig;

  // Focus is moved explicitly because the form remounts on every structure load.
  useEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });
  useEffect(() => {
    if (mapState.confirm) document.getElementById('map-confirm-keep')?.focus();
  }, [mapState.confirm]);

  const onFormChange = useCallback((f: FormState) => {
    setCurrent(f);
    setSaveInvalid(false);
  }, []);

  function perform(a: MapAction) {
    // Only `sections` is replaced; title, description and the other fields are kept.
    const next = formFromDraftMode(draft, a === 'list' ? 'list' : 'grid');
    const merged = withSections(current, next.sections);
    setFormInit(merged);
    setCurrent(merged);
    setLoadedSig(sectionsSignature(merged.sections));
    setSaveInvalid(false);
    if (a !== 'list') setPreviewOpen(true);
    pendingFocus.current = a === 'list' ? 'map-btn-preview' : 'map-preview-summary';
    dispatch({ type: 'done', action: a });
  }
  function onAction(a: MapAction) {
    if (edited) dispatch({ type: 'ask', action: a });
    else perform(a);
  }
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
      {mapping && (
        <MappingPanel
          mapping={mapping}
          state={mapState}
          edited={edited}
          form={current}
          previewOpen={previewOpen}
          onPreviewToggle={setPreviewOpen}
          saveInvalid={saveInvalid}
          invalid={mapState.mode === 'grid' && previewIssues(current).length > 0}
          onAction={onAction}
          onConfirm={() => mapState.confirm && perform(mapState.confirm)}
          onCancel={() => {
            pendingFocus.current = `map-btn-${mapState.confirm}`;
            dispatch({ type: 'cancel' });
          }}
        />
      )}
      {sourceText && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('import.review.source', { name: sourceText })}
        </p>
      )}
      {headless && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('import.review.headlessNote')}
        </p>
      )}
      {warnings.some((w) => w !== 'headless_used') && (
        <div className="rounded border border-neutral-500 p-3">
          <h2 className="font-semibold">{t('import.review.warnings')}</h2>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, i) =>
              w === 'headless_used' ? null : <li key={`${i}${w}`}>{warningMessage(t, w)}</li>,
            )}
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
      key={mapState.version}
      initial={formInit}
      onChange={mapping ? onFormChange : undefined}
      header={header}
      target={{
        url: `/api/import/${jobId}/save`,
        method: 'POST',
        extra: {
          import_cover: includeCover && draft.cover_image_url !== null,
          // An explicit view_mode only when the screen offered the choice; otherwise the API decides.
          ...saveViewMode(mapping, mapState.mode),
        },
        onInvalid: () => setSaveInvalid(true),
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
