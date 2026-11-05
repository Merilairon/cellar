import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { btn, btnPrimary } from '@/components/recipe/styles';
import { fieldId } from '@/components/recipe/FormField';
import type { MappingProposal } from '@/lib/import/map-types';
import type { FormState } from '@/lib/recipes/form-model';
import { LEVEL_BOX, MappingBadge } from './MappingBadge';
import { MappingPreview, previewCounts } from './MappingPreview';
import { stateKey, type MapAction, type MapState } from './mapping-state';
import { warningMessage } from './warnings';

const MAX_REASONS = 5;

export type MappingPanelProps = {
  mapping: MappingProposal;
  state: MapState;
  /** Sections differ from the last structure load. */
  edited: boolean;
  form: FormState;
  previewOpen: boolean;
  onPreviewToggle: (open: boolean) => void;
  /** The server rejected the last save as grid. */
  saveInvalid: boolean;
  /** The grid cannot be drawn from the current form. */
  invalid: boolean;
  onAction: (a: MapAction) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

// Imported text (ingredient names inside reasons, titles in the preview) only ever reaches the
// page as React text nodes.
export function MappingPanel(p: MappingPanelProps) {
  const t = useTranslations();
  const headingId = useId();
  const { mapping, state } = p;
  const level = mapping.level;
  const grid = state.mode === 'grid';

  const key = stateKey(state, p.edited);
  const stateText = [
    key === 'applied'
      ? t('import.review.mapping.state.applied')
      : key === 'edited'
        ? t('import.review.mapping.state.edited')
        : key === 'restored'
          ? t('import.review.mapping.state.restored')
          : key === 'list'
            ? t('import.review.mapping.state.list')
            : null,
    grid ? t('import.review.mapping.mode.grid') : t('import.review.mapping.mode.list'),
    grid && p.invalid ? t('import.review.mapping.state.invalid') : null,
    grid && p.saveInvalid ? t('import.review.mapping.state.saveInvalid') : null,
  ]
    .filter(Boolean)
    .join(' ');

  const reasons = mapping.warnings.slice(0, MAX_REASONS);
  const hidden = mapping.warnings.length - reasons.length;
  const toggleLabel =
    level === 'low'
      ? t('import.review.mapping.action.tryAnyway')
      : t('import.review.mapping.action.preview');

  const actionButton = (a: MapAction, label: string, primary = false) => (
    <button
      type="button"
      id={`map-btn-${a}`}
      className={primary ? btnPrimary : btn}
      onClick={() => p.onAction(a)}
    >
      {label}
    </button>
  );

  const actions = p.state.confirm ? (
    <div
      role="group"
      aria-labelledby="map-confirm-text"
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          p.onCancel();
        }
      }}
    >
      <p id="map-confirm-text">{t('import.review.mapping.confirm.text')}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" id="map-confirm-yes" className={btn} onClick={p.onConfirm}>
          {t('import.review.mapping.confirm.replace')}
        </button>
        <button type="button" id="map-confirm-keep" className={btnPrimary} onClick={p.onCancel}>
          {t('import.review.mapping.confirm.keep')}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {grid ? (
        <>
          {actionButton('list', t('import.review.mapping.action.useList'))}
          {p.edited && actionButton('reset', t('import.review.mapping.action.reset'))}
        </>
      ) : (
        actionButton('preview', toggleLabel, level !== 'low')
      )}
    </div>
  );

  const details = (
    <details open={level !== 'high'} className="group rounded">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
        <span
          aria-hidden="true"
          className="mr-2 inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          ▸
        </span>
        {t('import.review.mapping.details.summary')}
      </summary>
      <p>{t('import.review.mapping.details.score', { score: mapping.confidence.toFixed(2) })}</p>
      <ul className="mt-1 list-disc pl-5">
        {reasons.map((w, i) => (
          <li key={`${i}${w}`}>{warningMessage(t, w)}</li>
        ))}
        {hidden > 0 && <li>{t('import.review.mapping.details.more', { count: hidden })}</li>}
        {mapping.warnings.length === 0 && level !== 'high' && (
          <li>{t('import.review.mapping.details.reasonNone')}</li>
        )}
      </ul>
      <p className="mt-1">{t('import.review.mapping.details.proposalOnly')}</p>
    </details>
  );

  const counts = grid ? previewCounts(p.form) : null;
  const summaryId = `${headingId}-sum`;

  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 rounded border-2 p-3 ${LEVEL_BOX[level]}`}
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {t('import.review.mapping.heading')}
      </h2>
      <MappingBadge level={level} />
      <p role="status" id="map-state" className="font-medium">
        {stateText}
      </p>
      {level !== 'low' && actions}
      {details}
      <p>{t('import.review.mapping.fixHint')}</p>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer items-center">
          <span
            aria-hidden="true"
            className="mr-2 inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ▸
          </span>
          {t('import.review.mapping.explain.summary')}
        </summary>
        <p>{t('import.review.mapping.explain.body')}</p>
      </details>
      {level === 'low' && actions}
      {grid && (
        <details
          open={p.previewOpen}
          onToggle={(e) => p.onPreviewToggle(e.currentTarget.open)}
          className="group rounded p-2"
        >
          <summary
            id="map-preview-summary"
            aria-describedby={summaryId}
            className="flex min-h-11 cursor-pointer items-center text-lg font-semibold"
          >
            <span
              aria-hidden="true"
              className="mr-2 inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
            >
              ▸
            </span>
            {t('import.review.mapping.preview.heading')}
          </summary>
          <p id={summaryId} className="sr-only">
            {counts && t('import.review.mapping.preview.summary', counts)}
          </p>
          <a
            href={`#${fieldId('title')}`}
            className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center focus:underline"
          >
            {t('import.review.mapping.preview.skip')}
          </a>
          <MappingPreview form={p.form} />
        </details>
      )}
    </section>
  );
}
