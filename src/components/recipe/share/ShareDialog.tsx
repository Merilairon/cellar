'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { Visibility } from '@/lib/recipes/schemas';
import { SheetDialog } from '../SheetDialog';
import { btn, btnDanger, btnPrimary, errorText } from '../styles';
import { linkIsOn, summaryKey, type ShareAction, type ShareState } from './share-state';

const focusHeading = (d: HTMLDialogElement) => d.querySelector<HTMLElement>('[data-share-heading]');

export type ShareDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  state: ShareState;
  dispatch: (a: ShareAction) => void;
  /** Present only when the recipe counts as imported and unedited (copyright notice). */
  warningSource?: { source: string | null } | null;
  onVisibility: (v: Visibility) => void;
  onMakeLink: (which: 'on' | 'rotate') => void;
  onRevoke: () => void;
  onCopy: (field: HTMLInputElement | null) => void;
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The share dialog (UX spec sections 1 and 2). Presentational: all state comes from `useShare`. */
export function ShareDialog(p: ShareDialogProps) {
  const t = useTranslations();
  const { state, dispatch } = p;
  const uid = useId();
  const headingId = `${uid}-h`;
  const noticeId = `${uid}-notice`;
  const noticeTitleId = `${uid}-notice-t`;
  const linkHeadId = `${uid}-link`;
  const linkHelpId = `${uid}-link-help`;
  const noticeRef = p.warningSource ? noticeId : '';
  const linkOn = linkIsOn(state);

  const copyRef = useRef<HTMLButtonElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const rotateRef = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const to = state.focus?.to;
    if (!to) return;
    const target = { copy: copyRef, switch: switchRef, keep: keepRef, rotate: rotateRef }[to];
    target.current?.focus();
  }, [state.focus]); // the seq makes a repeated target fire again

  const statusText = (() => {
    const st = state.status;
    if (st === 'copied') return t('share.link.copiedStatus');
    if (st === 'copyManual') return t('share.link.copyManual');
    if (st === 'copyManualTouch') return t('share.link.copyManualTouch');
    if (st === 'rotated') return t('share.link.rotated');
    return t(summaryKey(state.visibility, linkOn));
  })();

  const busy = state.busy !== null;
  const describedBy = (id: string) => [id, noticeRef].filter(Boolean).join(' ');
  const warnText = p.warningSource
    ? p.warningSource.source
      ? t('share.warning.body', { source: p.warningSource.source })
      : t('share.warning.bodyNoSource')
    : null;

  const radio = (value: Visibility, label: string, help: string, helpId: string) => (
    <div className="mt-2">
      <label className="flex min-h-11 items-center gap-3 rounded has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--rg-focus)]">
        <input
          type="radio"
          name={`${uid}-who`}
          className="size-5"
          checked={state.visibility === value}
          aria-describedby={value === 'users' ? describedBy(helpId) : helpId}
          onChange={() => p.onVisibility(value)}
        />
        <span className="font-medium">{label}</span>
      </label>
      <p id={helpId} className="ml-8 text-sm text-neutral-700 dark:text-neutral-300">
        {help}
      </p>
    </div>
  );

  const switchWord =
    state.busy === 'on'
      ? t('share.link.turningOn')
      : t(linkOn ? 'share.link.on' : 'share.link.off');
  const switchDisabled = busy || state.confirm === 'off';

  return (
    <SheetDialog
      open={p.open}
      onClose={p.onClose}
      labelledBy={headingId}
      initialFocus={focusHeading}
      className="share-dialog overflow-y-auto overscroll-contain sm:m-auto! sm:max-h-[90dvh]! sm:w-[min(32rem,calc(100vw-2rem))]! sm:rounded-xl!"
    >
      {p.open && (
        <div className="rg-sheet-body p-4 sm:p-6!">
          <div className="flex items-start justify-between gap-3">
            <h2
              id={headingId}
              data-share-heading
              tabIndex={-1}
              className="text-lg font-semibold outline-none"
            >
              {t('share.title')}
            </h2>
            <button type="button" className={`${btn} gap-2`} onClick={p.onClose}>
              <Icon d="M6 6l12 12M18 6L6 18" />
              {t('share.close')}
            </button>
          </div>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{p.title}</p>
          <p role="status" className="mt-3">
            {statusText}
          </p>

          {p.warningSource && warnText && (
            <div
              id={noticeId}
              role="note"
              aria-labelledby={noticeTitleId}
              className="mt-3 rounded-lg border border-[var(--ge-warn-line)] bg-[var(--ge-warn-bg)] p-3 text-[var(--ge-warn-ink)]"
            >
              <p id={noticeTitleId} className="flex items-center gap-2 font-semibold">
                <Icon d="M12 4l9 16H3zM12 10v4M12 17v.5" />
                {t('share.warning.title')}
              </p>
              <p className="mt-1 text-sm">{warnText}</p>
            </div>
          )}

          <fieldset className="mt-4">
            <legend className="font-semibold">{t('share.who.legend')}</legend>
            {radio('private', t('share.who.private'), t('share.who.privateHelp'), `${uid}-ph`)}
            {radio('users', t('share.who.users'), t('share.who.usersHelp'), `${uid}-uh`)}
            {state.visError && (
              <p role="alert" className={errorText}>
                {t(state.visError === 'forbidden' ? 'share.error.forbidden' : 'share.error.save')}
              </p>
            )}
          </fieldset>

          <section className="mt-5">
            <h3 id={linkHeadId} className="font-semibold">
              {t('share.link.heading')}
            </h3>
            {!state.linksEnabled ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-[var(--rg-muted)]">
                <Icon d="M12 8v.5M12 11v6M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0" />
                {t('share.link.disabled')}
              </p>
            ) : (
              <>
                <div className="mt-1 flex items-center gap-3">
                  <button
                    ref={switchRef}
                    type="button"
                    role="switch"
                    aria-checked={linkOn}
                    aria-labelledby={linkHeadId}
                    aria-describedby={describedBy(linkHelpId)}
                    aria-busy={state.busy === 'on' || undefined}
                    aria-disabled={switchDisabled || undefined}
                    className="inline-flex min-h-11 min-w-11 items-center rounded outline-offset-2"
                    onClick={() => {
                      if (switchDisabled) return;
                      if (linkOn) dispatch({ type: 'confirm', which: 'off' });
                      else p.onMakeLink('on');
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={`relative block h-6 w-11 rounded-full ${linkOn ? 'bg-[var(--rg-accent)]' : 'bg-[var(--rg-muted)]'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 block size-5 rounded-full bg-[var(--rg-surface)] motion-safe:transition-transform ${linkOn ? 'translate-x-5' : ''}`}
                      />
                    </span>
                  </button>
                  <span aria-hidden="true">{switchWord}</span>
                </div>
                <p id={linkHelpId} className="text-sm text-neutral-700 dark:text-neutral-300">
                  {t('share.link.help')}
                </p>

                {state.confirm === 'off' && (
                  <div role="group" aria-labelledby={`${uid}-off-q`} className="mt-3">
                    <p id={`${uid}-off-q`}>{t('share.link.offConfirm')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnDanger}
                        disabled={busy}
                        onClick={p.onRevoke}
                      >
                        {t('share.link.offYes')}
                      </button>
                      <button
                        ref={keepRef}
                        type="button"
                        className={btn}
                        disabled={busy}
                        onClick={() => dispatch({ type: 'dismissConfirm' })}
                      >
                        {t('share.link.keep')}
                      </button>
                    </div>
                  </div>
                )}
                {(state.linkError === 'turnOn' ||
                  state.linkError === 'turnOff' ||
                  state.linkError === 'forbidden') && (
                  <p role="alert" className={errorText}>
                    {t(
                      state.linkError === 'turnOn'
                        ? 'share.error.turnOn'
                        : state.linkError === 'turnOff'
                          ? 'share.error.turnOff'
                          : 'share.error.forbidden',
                    )}
                  </p>
                )}

                {linkOn && state.url && (
                  <div className="mt-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        ref={field}
                        type="text"
                        readOnly
                        value={state.url}
                        aria-label={t('share.link.field')}
                        className="min-h-11 w-full rounded border border-neutral-500 bg-transparent p-2 font-mono text-sm"
                        onFocus={(e) => e.currentTarget.select()}
                        onClick={(e) => e.currentTarget.select()}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          ref={copyRef}
                          type="button"
                          className={btn}
                          onClick={() => p.onCopy(field.current)}
                        >
                          {t('share.link.copy')}
                        </button>
                        {state.status === 'copied' && (
                          <span className="text-sm" aria-hidden="true">
                            {t('share.link.copied')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      <button
                        ref={rotateRef}
                        type="button"
                        className={btn}
                        aria-disabled={busy || undefined}
                        onClick={() => {
                          if (busy) return;
                          dispatch({ type: 'confirm', which: 'rotate' });
                        }}
                      >
                        {t('share.link.rotate')}
                      </button>
                    </div>
                    {state.confirm === 'rotate' && (
                      <div role="group" aria-labelledby={`${uid}-rotate-q`} className="mt-3">
                        <p id={`${uid}-rotate-q`}>{t('share.link.rotateConfirm')}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={btnPrimary}
                            disabled={busy}
                            onClick={() => p.onMakeLink('rotate')}
                          >
                            {t('share.link.rotateYes')}
                          </button>
                          <button
                            ref={keepRef}
                            type="button"
                            className={btn}
                            disabled={busy}
                            onClick={() => dispatch({ type: 'dismissConfirm' })}
                          >
                            {t('share.link.keep')}
                          </button>
                        </div>
                      </div>
                    )}
                    {state.linkError === 'rotate' && (
                      <p role="alert" className={errorText}>
                        {t('share.error.rotate')}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </SheetDialog>
  );
}
