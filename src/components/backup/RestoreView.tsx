import { useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { btn, btnPrimary, errorText } from '../recipe/styles';
import {
  applyCount,
  formatBytes,
  isPartial,
  resultLines,
  type RestoreAction,
  type RestoreError,
  type RestoreState,
} from './backup-logic';
import { PreviewTable } from './PreviewTable';

const ERROR_KEYS = {
  extension: 'backup.error.extension',
  tooLarge: 'backup.error.tooLarge',
  backup_version_unsupported: 'backup.error.backup_version_unsupported',
  backup_invalid: 'backup.error.backup_invalid',
  zip_invalid: 'backup.error.zip_invalid',
  scope_forbidden: 'backup.error.scope_forbidden',
  in_progress: 'backup.error.in_progress',
  expired: 'backup.error.expired',
  unauthenticated: 'backup.error.unauthenticated',
  network: 'backup.error.network',
} as const;

const LINE_KEYS = {
  imported: 'backup.result.imported',
  renamed: 'backup.result.renamed',
  skipped: 'backup.result.skipped',
  photos: 'backup.result.photos',
  photosFailed: 'backup.result.photosFailed',
  notesSkipped: 'backup.result.notesSkipped',
} as const;

export type RestoreViewProps = {
  state: RestoreState;
  role: 'admin' | 'member';
  dispatch: (a: RestoreAction) => void;
  onPick: (file: File | null) => void;
  onCheck: () => void;
  onCancelUpload: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onAgain: () => void;
  pickerRef?: React.Ref<HTMLInputElement>;
  captionRef?: React.Ref<HTMLElement>;
  resultRef?: React.Ref<HTMLHeadingElement>;
};

function ErrorLine({ error, id }: { error: RestoreError | null; id?: string }) {
  const t = useTranslations();
  if (!error) return null;
  const text =
    error.message ??
    t(ERROR_KEYS[error.key as keyof typeof ERROR_KEYS] ?? ERROR_KEYS.network, error.params);
  return (
    <div role="alert" id={id}>
      <p className={errorText}>
        {text}
        {error.params?.version !== undefined && error.key === 'backup_version_unsupported' && (
          <> {t('backup.error.versionFound', { version: error.params.version })}</>
        )}
      </p>
      {error.details && (
        <ul className={`${errorText} list-disc pl-6 break-words`}>
          {error.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Restore section (UX spec 5.3): presentational, all state comes from `useRestore`. */
export function RestoreView({
  state,
  role,
  dispatch,
  onPick,
  onCheck,
  onCancelUpload,
  onApply,
  onDiscard,
  onAgain,
  pickerRef,
  captionRef,
  resultRef,
}: RestoreViewProps) {
  const t = useTranslations();
  const uid = useId();
  const busy =
    state.phase === 'uploading' || state.phase === 'checking' || state.phase === 'applying';
  const errId = `${uid}-err`;
  const reasonId = `${uid}-reason`;
  const preview = state.stage?.preview;

  return (
    <section aria-labelledby={`${uid}-h`} aria-busy={busy} className="space-y-3">
      <h2 id={`${uid}-h`} className="text-xl font-semibold">
        {t('backup.restore.heading')}
      </h2>
      <p className="text-neutral-700 dark:text-neutral-300">{t('backup.restore.intro')}</p>

      {(state.phase === 'idle' || state.phase === 'uploading' || state.phase === 'checking') && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={`${btn} cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--rg-focus)] ${state.phase === 'idle' ? '' : 'pointer-events-none opacity-50'}`}
            >
              <input
                ref={pickerRef}
                type="file"
                className="sr-only"
                accept=".json,.zip,application/json,application/zip"
                disabled={state.phase !== 'idle'}
                aria-describedby={state.error ? errId : undefined}
                onChange={(e) => {
                  onPick(e.target.files?.[0] ?? null);
                }}
              />
              {t('backup.restore.choose')}
            </label>
            {state.file && (
              <span className="break-all">
                {t('backup.restore.fileInfo', {
                  name: state.file.name,
                  size: formatBytes(state.file.size),
                })}
              </span>
            )}
          </div>
          {state.phase === 'idle' ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={`${btnPrimary} ${state.file ? '' : 'opacity-60'}`}
                aria-disabled={!state.file}
                aria-describedby={!state.file ? reasonId : undefined}
                onClick={() => {
                  if (state.file) onCheck();
                }}
              >
                {t('backup.restore.check')}
              </button>
              {!state.file && (
                <span id={reasonId} className="text-sm text-neutral-700 dark:text-neutral-300">
                  {t('backup.restore.chooseFirst')}
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div role="status" className="flex flex-col gap-1">
                <span>
                  {state.phase === 'uploading'
                    ? t('backup.restore.uploading', { percent: state.percent })
                    : t('backup.restore.checking')}
                </span>
                {state.phase === 'uploading' ? (
                  <progress max={100} value={state.percent} className="w-full max-w-md" />
                ) : (
                  <progress className="w-full max-w-md" />
                )}
              </div>
              <button type="button" className={btn} onClick={onCancelUpload}>
                {t('backup.restore.cancel')}
              </button>
            </div>
          )}
          <ErrorLine error={state.error} id={errId} />
        </div>
      )}

      {(state.phase === 'preview' || state.phase === 'applying') && preview && (
        <div className="space-y-4">
          <PreviewTable preview={preview} role={role} captionRef={captionRef} />
          <fieldset className="space-y-1" disabled={state.phase === 'applying'}>
            <legend className="font-semibold">{t('backup.strategy.legend')}</legend>
            {(['skip', 'rename'] as const).map((s) => (
              <label key={s} className="flex min-h-11 items-start gap-3 py-2">
                <input
                  type="radio"
                  name={`${uid}-strategy`}
                  className="mt-1 size-5 shrink-0 accent-emerald-700"
                  checked={state.strategy === s}
                  onChange={() => dispatch({ type: 'strategy', strategy: s })}
                />
                <span>{t(s === 'skip' ? 'backup.strategy.skip' : 'backup.strategy.rename')}</span>
              </label>
            ))}
          </fieldset>
          <ApplyBar
            state={state}
            onApply={onApply}
            onDiscard={onDiscard}
            count={applyCount(preview, state.strategy)}
            reasonId={reasonId}
            errId={errId}
          />
        </div>
      )}

      {state.phase === 'result' && state.result && (
        <div className="space-y-3">
          <div role="status">
            <h3
              ref={resultRef}
              tabIndex={-1}
              className="text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--rg-focus)]"
            >
              {t(
                isPartial(state.result) ? 'backup.result.stoppedHeading' : 'backup.result.heading',
              )}
            </h3>
            <ul className="mt-1 list-disc pl-6">
              {isPartial(state.result) && (
                <>
                  <li>
                    {t('backup.result.stoppedBefore', {
                      count: state.result.imported + state.result.renamed,
                    })}
                  </li>
                  <li>
                    {t('backup.result.stoppedAt', {
                      index: state.result.failed_at ?? 0,
                      total: state.stage?.preview.recipes ?? 0,
                    })}
                  </li>
                </>
              )}
              {resultLines(state.result)
                .filter((l) => !(isPartial(state.result!) && l.key === 'imported'))
                .map((l) => (
                  <li key={l.key}>
                    {t(LINE_KEYS[l.key as keyof typeof LINE_KEYS], { count: l.count })}
                  </li>
                ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/recipes" className={btnPrimary}>
              {t('backup.result.openRecipes')}
            </Link>
            <button type="button" className={btn} onClick={onAgain}>
              {t('backup.result.again')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ApplyBar({
  state,
  onApply,
  onDiscard,
  count,
  reasonId,
  errId,
}: {
  state: RestoreState;
  onApply: () => void;
  onDiscard: () => void;
  count: number;
  reasonId: string;
  errId: string;
}) {
  const t = useTranslations();
  const applying = state.phase === 'applying';
  const none = count === 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${btnPrimary} ${none ? 'opacity-60' : ''}`}
          aria-disabled={none}
          disabled={applying}
          aria-describedby={none ? reasonId : undefined}
          onClick={() => {
            if (!none) onApply();
          }}
        >
          {t('backup.apply', { count })}
        </button>
        <button type="button" className={btn} disabled={applying} onClick={onDiscard}>
          {t('backup.restore.cancel')}
        </button>
      </div>
      {none && !applying && (
        <p id={reasonId} className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('backup.applyNone')}
        </p>
      )}
      {applying && (
        <div role="status" className="flex flex-col gap-1">
          <span>{t('backup.restore.restoring')}</span>
          <progress className="w-full max-w-md" />
        </div>
      )}
      <ErrorLine error={state.error} id={errId} />
    </div>
  );
}
