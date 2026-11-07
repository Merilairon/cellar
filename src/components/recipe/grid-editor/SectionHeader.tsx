'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { btn, btnDanger, errorText, input } from '../styles';

export type SectionHeaderProps = {
  index: number;
  sectionKey: string;
  /** Visible heading text (the title, or the "Section n" fallback). */
  title: string;
  /** The stored title, for the rename field. */
  rawTitle: string | null;
  /** More than one section: a title is required. */
  multiple: boolean;
  /** Rows and steps the section holds (delete asks first when either is non-zero). */
  rowCount: number;
  stepCount: number;
  atRowCap: boolean;
  capMessage: string | null;
  /** Commit a rename (empty only reaches here when the recipe has one section). */
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddRow: () => void;
  /** F5: a token that grows each time this section should open its rename field (0 = never). */
  promptRename?: number;
  /** SEAM T6: Add step / Add banner buttons render here, in the same toolbar group. */
  extraActions?: React.ReactNode;
};

/**
 * Section heading plus its toolbar (UX spec 9): inline rename, delete with an inline confirm
 * when the section holds anything, and Add row. The heading stays a real `h3`.
 */
export function SectionHeader(p: SectionHeaderProps) {
  const t = useTranslations();
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // F13: the "needs at least one section" line is read out with the button but only shown once
  // the user pressed Delete section on the only section.
  const [lastShown, setLastShown] = useState(false);
  // F5: open the rename field when the parent asks (a section was just added).
  const [promptSeen, setPromptSeen] = useState(0);
  const prompt = p.promptRename ?? 0;
  if (prompt !== 0 && prompt !== promptSeen) {
    setPromptSeen(prompt);
    setRenaming(true);
  }
  const renameBtn = useRef<HTMLButtonElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const errId = `ge-sec-err-${p.index}`;
  const lastId = `ge-sec-last-${p.index}`;
  const capId = `ge-sec-cap-${p.index}`;

  useEffect(() => {
    if (renaming) {
      done.current = false;
      field.current?.focus();
      field.current?.select();
    }
  }, [renaming]);
  useEffect(() => {
    if (confirming) keepBtn.current?.focus();
  }, [confirming]);

  const commit = (value: string, viaBlur: boolean) => {
    if (done.current) return;
    const v = value.trim();
    if (!v && p.multiple && !(viaBlur && (p.rawTitle ?? '') === '')) {
      // F14: an empty name is refused with the message, also on blur, so an existing name is
      // never dropped silently. The one exception is a blur on a section that never had a
      // name: nothing to lose, so the field just closes.
      setError(true);
      return;
    }
    if (!v && p.multiple) {
      done.current = true;
      setRenaming(false);
      setError(false);
      return;
    }
    done.current = true;
    setRenaming(false);
    setError(false);
    if (v !== (p.rawTitle ?? '')) p.onRename(v);
    if (!viaBlur) setTimeout(() => renameBtn.current?.focus(), 0);
  };
  const cancel = () => {
    done.current = true;
    setRenaming(false);
    setError(false);
    setTimeout(() => renameBtn.current?.focus(), 0);
  };

  const onlySection = !p.multiple;
  const empty = p.rowCount === 0 && p.stepCount === 0;

  return (
    <div className="ge-sechead flex flex-col gap-2">
      <h3 id={`ge-sec-${p.index}`} tabIndex={-1} data-ge-heading={p.sectionKey} className="ge-h3">
        {renaming ? (
          <>
            <input
              ref={field}
              type="text"
              className={`${input} max-w-sm font-normal`}
              defaultValue={p.rawTitle ?? ''}
              maxLength={120}
              aria-label={t('gridEditor.section.renameLabel')}
              placeholder={t('gridEditor.section.renamePlaceholder')}
              aria-invalid={error || undefined}
              aria-describedby={error ? errId : undefined}
              onBlur={(e) => commit(e.target.value, true)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(e.currentTarget.value, false);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                }
              }}
            />
            {error && (
              <span id={errId} role="alert" className={`${errorText} block font-normal`}>
                {t('gridEditor.section.renameEmpty')}
              </span>
            )}
          </>
        ) : (
          p.title
        )}
      </h3>
      {confirming ? (
        <div
          role="group"
          aria-label={t('gridEditor.section.delete')}
          className="ge-confirm"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setConfirming(false);
              setTimeout(() => renameBtn.current?.focus(), 0);
            }
          }}
        >
          <span>
            {t('gridEditor.section.deleteConfirm', {
              title: p.title,
              rows: p.rowCount,
              steps: p.stepCount,
            })}
          </span>
          <button
            ref={keepBtn}
            type="button"
            className={btn}
            onClick={() => {
              setConfirming(false);
              setTimeout(() => renameBtn.current?.focus(), 0);
            }}
          >
            {t('gridEditor.section.deleteKeep')}
          </button>
          <button
            type="button"
            className={btnDanger}
            onClick={() => {
              setConfirming(false);
              p.onDelete();
            }}
          >
            {t('gridEditor.section.deleteDo')}
          </button>
        </div>
      ) : (
        <div
          role="group"
          aria-label={t('gridEditor.section.actionsFor', { title: p.title })}
          className="ge-toolbar-row"
        >
          <button ref={renameBtn} type="button" className={btn} onClick={() => setRenaming(true)}>
            {t('gridEditor.section.rename')}
          </button>
          <button
            type="button"
            className={`${btn} aria-disabled:opacity-50`}
            aria-disabled={onlySection ? true : undefined}
            aria-describedby={onlySection ? lastId : undefined}
            onClick={() => {
              if (onlySection) {
                setLastShown(true);
                return;
              }
              if (empty) p.onDelete();
              else setConfirming(true);
            }}
          >
            {t('gridEditor.section.delete')}
          </button>
          <button
            type="button"
            className={`${btn} aria-disabled:opacity-50`}
            aria-disabled={p.atRowCap ? true : undefined}
            aria-describedby={p.atRowCap ? capId : undefined}
            data-ge-addrow={p.sectionKey}
            onClick={p.onAddRow}
          >
            {t('gridEditor.row.add')}
          </button>
          {p.extraActions}
        </div>
      )}
      {onlySection && (
        <p id={lastId} className={lastShown ? 'ge-muted' : 'sr-only'}>
          {t('gridEditor.section.last')}
        </p>
      )}
      {p.multiple && !p.rawTitle && !renaming && (
        <p className="ge-muted">{t('gridEditor.section.untitledHint')}</p>
      )}
      {p.atRowCap && p.capMessage && (
        <p id={capId} className="ge-muted">
          {p.capMessage}
        </p>
      )}
    </div>
  );
}
