'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { input } from '../styles';
import { MAX_LINE, parseRowText } from './ingredient-text';

export type RowEditEnd =
  /** Enter or blur: the typed text (may be empty), and whether Ctrl/Cmd+Enter asked for a new row. */
  { type: 'commit'; text: string; addBelow: boolean; viaBlur: boolean } | { type: 'cancel' };

/**
 * The inline text edit of one ingredient (G11, Q7): a single line, a parsed preview that
 * updates after 200 ms idle (visual only, read on focus through aria-describedby), commit on
 * Enter or blur, Escape cancels. Parsing and the reducer call belong to the parent.
 */
export function IngredientRowEditor({
  n,
  initial,
  previewId,
  onEnd,
}: {
  n: number;
  initial: string;
  previewId: string;
  onEnd: (end: RowEditEnd) => void;
}) {
  const t = useTranslations();
  const [text, setText] = useState(initial);
  const [shown, setShown] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setShown(text), 200);
    return () => clearTimeout(id);
  }, [text]);

  const finish = (end: RowEditEnd) => {
    if (done.current) return;
    done.current = true;
    onEnd(end);
  };

  const parsed = parseRowText(shown);
  const preview = !parsed.ok
    ? ''
    : parsed.fallback
      ? t('gridEditor.row.previewFallback')
      : t('gridEditor.row.preview', { parsed: parsed.preview });

  return (
    <div className="ge-rowedit flex w-full flex-col gap-1 p-2">
      <input
        ref={ref}
        type="text"
        className={`${input} min-h-[var(--ge-target)] font-normal`}
        value={text}
        maxLength={MAX_LINE}
        spellCheck={false}
        aria-label={t('gridEditor.row.editLabel', { n })}
        aria-describedby={previewId}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) =>
          finish({ type: 'commit', text: e.target.value, addBelow: false, viaBlur: true })
        }
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            finish({
              type: 'commit',
              text: e.currentTarget.value,
              addBelow: e.ctrlKey || e.metaKey,
              viaBlur: false,
            });
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish({ type: 'cancel' });
          }
        }}
      />
      <p id={previewId} className="ge-muted text-sm font-normal">
        {preview}
      </p>
    </div>
  );
}

/** Small text field for a portion label ("half", "remaining"); same commit/cancel rules. */
export function PortionLabelInput({
  name,
  initial,
  onEnd,
}: {
  name: string;
  initial: string;
  onEnd: (end: { type: 'commit'; text: string; viaBlur: boolean } | { type: 'cancel' }) => void;
}) {
  const t = useTranslations();
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (end: Parameters<typeof onEnd>[0]) => {
    if (done.current) return;
    done.current = true;
    onEnd(end);
  };
  return (
    <input
      ref={ref}
      type="text"
      defaultValue={initial}
      maxLength={60}
      className={`${input} ml-2 min-h-[var(--ge-target)] w-40 font-normal`}
      aria-label={t('gridEditor.row.portionLabel', { name })}
      onBlur={(e) => finish({ type: 'commit', text: e.target.value, viaBlur: true })}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish({ type: 'commit', text: e.currentTarget.value, viaBlur: false });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish({ type: 'cancel' });
        }
      }}
    />
  );
}
