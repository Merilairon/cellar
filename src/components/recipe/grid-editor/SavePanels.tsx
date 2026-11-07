'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { btn, btnDanger, btnPrimary } from '../styles';
import type { ConflictConfirm } from './useSaveFlow';

/** UX spec 12.4: replaces the issues zone. Focus moves to the heading. */
export function ConflictPanel({
  confirm,
  focusKey,
  onConfirm,
  onKeep,
  onLoad,
  onSaveMine,
}: {
  confirm: ConflictConfirm;
  focusKey: number;
  onConfirm: (c: ConflictConfirm) => void;
  onKeep: () => void;
  onLoad: () => void;
  onSaveMine: () => void;
}) {
  const t = useTranslations();
  const heading = useRef<HTMLHeadingElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'center' });
  }, [focusKey]);
  useEffect(() => {
    if (confirm) keep.current?.focus();
  }, [confirm]);
  const confirming = confirm !== null;
  return (
    <section aria-labelledby="ge-conflict-h" className="ge-issues ge-conflict">
      <h3 id="ge-conflict-h" ref={heading} tabIndex={-1} className="ge-h3">
        {t('gridEditor.conflict.title')}
      </h3>
      <p>{t('gridEditor.conflict.body')}</p>
      {confirming ? (
        <div
          role="group"
          aria-label={t(
            confirm === 'load'
              ? 'gridEditor.conflict.loadLatestConfirm'
              : 'gridEditor.conflict.overwriteConfirm',
          )}
          className="ge-confirm"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onConfirm(null);
            }
          }}
        >
          <span>
            {t(
              confirm === 'load'
                ? 'gridEditor.conflict.loadLatestConfirm'
                : 'gridEditor.conflict.overwriteConfirm',
            )}
          </span>
          <button ref={keep} type="button" className={btn} onClick={() => onConfirm(null)}>
            {t('gridEditor.conflict.back')}
          </button>
          <button
            type="button"
            className={btnDanger}
            onClick={confirm === 'load' ? onLoad : onSaveMine}
          >
            {t(
              confirm === 'load'
                ? 'gridEditor.conflict.loadLatestYes'
                : 'gridEditor.conflict.overwriteYes',
            )}
          </button>
        </div>
      ) : (
        <div className="ge-confirm">
          <button ref={keep} type="button" className={btnPrimary} onClick={onKeep}>
            {t('gridEditor.conflict.keepEditing')}
          </button>
          <button type="button" className={btn} onClick={() => onConfirm('load')}>
            {t('gridEditor.conflict.loadLatest')}
          </button>
          <button type="button" className={btnDanger} onClick={() => onConfirm('overwrite')}>
            {t('gridEditor.conflict.overwrite')}
          </button>
        </div>
      )}
    </section>
  );
}

/** UX spec 12.3: inline alert in the toolbar zone; focus goes to Try again. */
export function NetworkAlert({ focusKey, onRetry }: { focusKey: number; onRetry: () => void }) {
  const t = useTranslations();
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    retry.current?.focus();
  }, [focusKey]);
  return (
    <div role="alert" className="ge-warnline ge-netalert">
      <span>{t('gridEditor.save.failed')}</span>{' '}
      <button ref={retry} type="button" className={btn} onClick={onRetry}>
        {t('gridEditor.save.retry')}
      </button>
    </div>
  );
}

/** UX spec 12.5: shown at once while no section has a column step. */
export function ListNotice({ onAddStep }: { onAddStep: (() => void) | null }) {
  const t = useTranslations();
  return (
    <p className="ge-warnline" data-testid="ge-list-notice">
      <span aria-hidden="true">!</span> {t('gridEditor.save.viewModeList')}{' '}
      {onAddStep && (
        <button type="button" className="ge-linkbtn" onClick={onAddStep}>
          {t('gridEditor.save.addStep')}
        </button>
      )}
    </p>
  );
}
