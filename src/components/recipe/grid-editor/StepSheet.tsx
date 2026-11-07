'use client';

import { useCallback, useEffect, useRef } from 'react';
import { SheetDialog } from '../SheetDialog';
import { StepPanel, type StepPanelProps } from './StepPanel';

/** Rows to keep clear of the sheet when scrolling the moved edge into view. */
const EDGE_GAP = 12;

/**
 * Phone bottom sheet (T8, UX spec 5): the step panel in its `sheet` variant on the shared
 * native-dialog primitive. Focus lands on the heading; each stepper press is already a reducer
 * action, so the grid behind updates live and Close only closes. After a span change the page
 * scrolls so the edge just moved stays above the sheet.
 */
export function StepSheet({ onClose, ...panel }: StepPanelProps & { onClose: () => void }) {
  const { step } = panel;
  const headingId = `ge-sheet-${step.key}`;
  const box = useRef<HTMLDivElement>(null);
  // undefined: nothing seen yet, so the first run brings the span's start row above the sheet.
  const startRef = useRef<number | null | undefined>(undefined);
  const endRef = useRef(step.row_end);

  const initialFocus = useCallback(
    (d: HTMLDialogElement) => d.querySelector<HTMLElement>('.ge-h4'),
    [],
  );

  useEffect(() => {
    const moved =
      step.row_start !== startRef.current
        ? step.row_start
        : step.row_end !== endRef.current
          ? step.row_end
          : null;
    startRef.current = step.row_start;
    endRef.current = step.row_end;
    if (moved == null) return;
    const row = panel.section.ingredients[moved];
    const cell = row && document.querySelector<HTMLElement>(`[data-ge-target="row:${row.key}"]`);
    const sheetTop = box.current?.closest('dialog')?.getBoundingClientRect().top;
    if (!cell || sheetTop === undefined) return;
    const r = cell.getBoundingClientRect();
    const hidden = r.bottom + EDGE_GAP - sheetTop;
    if (hidden > 0) window.scrollBy({ top: hidden, behavior: 'instant' });
    else if (r.top < EDGE_GAP) window.scrollBy({ top: r.top - EDGE_GAP, behavior: 'instant' });
  }, [step.row_start, step.row_end, panel.section.ingredients]);

  return (
    <SheetDialog
      open
      onClose={onClose}
      labelledBy={headingId}
      className="ge-sheet"
      initialFocus={initialFocus}
    >
      <div ref={box} className="rg-sheet-body ge-sheetbody">
        <StepPanel {...panel} headingId={headingId} sheet={{ onClose }} />
      </div>
    </SheetDialog>
  );
}
