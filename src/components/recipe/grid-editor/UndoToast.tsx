'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { EditorDoc } from '@/lib/grid/editor';
import { btn } from '../styles';

export const TOAST_MS = 10_000;

export type ToastState = {
  /** Visual twin of the live-region message. */
  message: string;
  /** Runs when Undo is pressed (dispatch undo, then restore focus). */
  onUndo: () => void;
  /** Document right after the deleting action; Undo hides once anything else changed it. */
  doc: EditorDoc | null;
};

/**
 * The delete-with-Undo toast (Q2, UX spec 10): 10 s, paused while hovered or focused, replaced
 * (not stacked) by the next one. The visible text is `aria-hidden`: the editor's single polite
 * region already says it. Its buttons stay reachable.
 */
export function UndoToast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const t = useTranslations();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(id);
  }, [paused, onDismiss, toast]);
  return (
    <div
      className="ge-toast fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center gap-2 rounded px-3 py-2 shadow-lg"
      style={{ background: 'var(--ge-toast-bg)', color: 'var(--ge-toast-ink)' }}
      data-ge-toast
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span aria-hidden="true" className="flex-1">
        {toast.message}
      </span>
      <button type="button" className={`${btn} !border-current`} onClick={toast.onUndo}>
        {t('gridEditor.toast.undo')}
      </button>
      <button type="button" className={`${btn} !border-current`} onClick={onDismiss}>
        {t('gridEditor.toast.dismiss')}
      </button>
    </div>
  );
}
