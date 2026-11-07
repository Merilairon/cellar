'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Bottom-sheet primitive on a native modal `<dialog>`: focus trap, Escape and backdrop close,
 * background scroll lock. Shared by the read view's step sheet and the grid editor's sheets.
 * `className` adds variants (editor: lighter backdrop, 55 dvh cap). `initialFocus` overrides the
 * browser's "first focusable" on open.
 */
export function SheetDialog({
  open,
  onClose,
  labelledBy,
  className = '',
  initialFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  initialFocus?: (dialog: HTMLDialogElement) => HTMLElement | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Set while the sheet is torn down by React, so its late `close` event is not a user close.
  const tearingDown = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      initialFocus?.(d)?.focus();
    } else if (!open && d.open) d.close();
  }, [open, initialFocus]);

  // The native modal does not stop the page behind from scrolling on every browser.
  useEffect(() => {
    if (!open) return;
    tearingDown.current = false;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const d = ref.current;
    return () => {
      document.body.style.overflow = prev;
      tearingDown.current = true;
      if (d?.open) d.close();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`rg-sheet ${className}`.trim()}
      aria-labelledby={labelledBy}
      onClose={() => {
        if (!tearingDown.current) onClose();
      }}
      // A click on the dialog element itself (not its body) is a click on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
