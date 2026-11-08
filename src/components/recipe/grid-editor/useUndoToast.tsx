'use client';

import { useCallback, useState } from 'react';
import type { EditorDoc } from '@/lib/grid/editor';
import { UndoToast, type ToastState } from './UndoToast';

/**
 * Toast state for delete-with-Undo. The toast's Undo is offered only while the deleting action
 * is still the latest document change, so it can never undo something unrelated.
 */
export function useUndoToast(present: EditorDoc) {
  const [toast, setToast] = useState<ToastState | null>(null);

  // `showToast` and the deleting dispatch land in one render; capture the resulting document
  // right then (adjusting state during render, not in an effect).
  if (toast && toast.doc === null) setToast({ ...toast, doc: present });

  const dismiss = useCallback(() => setToast(null), []);
  const showToast = useCallback((message: string, onUndo: () => void) => {
    setToast({
      message,
      doc: null,
      onUndo: () => {
        setToast(null);
        onUndo();
      },
    });
  }, []);

  const visible = toast && (toast.doc === null || toast.doc === present) ? toast : null;
  const toastNode = visible ? <UndoToast toast={visible} onDismiss={dismiss} /> : null;
  return { showToast, dismissToast: dismiss, toastNode };
}
