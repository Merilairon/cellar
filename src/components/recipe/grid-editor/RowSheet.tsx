'use client';

import { useCallback, useId } from 'react';
import { useTranslations } from 'next-intl';
import { SheetDialog } from '../SheetDialog';
import { btn } from '../styles';

export type RowSheetItem = { id: string; label: string; disabled?: boolean };

/**
 * Phone "Row actions" sheet (UX spec 5, 7): the same items as the 640 to 899 menu, as large
 * buttons in the shared bottom-sheet dialog. Picking an item closes the sheet first (focus goes
 * back to the Row actions button), then runs the action.
 */
export function RowSheet({
  name,
  items,
  onPick,
  onClose,
}: {
  name: string;
  items: RowSheetItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const headId = useId();
  const initialFocus = useCallback(
    (d: HTMLDialogElement) => d.querySelector<HTMLElement>('[data-ge-sheet-head]'),
    [],
  );
  return (
    <SheetDialog
      open
      onClose={onClose}
      labelledBy={headId}
      className="ge-sheet"
      initialFocus={initialFocus}
    >
      <div className="rg-sheet-body ge-sheetbody">
        <div className="ge-panelhead">
          <h4 id={headId} className="ge-h4" tabIndex={-1} data-ge-sheet-head>
            {t('gridEditor.row.actionsFor', { name })}
          </h4>
          <button type="button" className={btn} onClick={onClose}>
            {t('gridEditor.sheet.close')}
          </button>
        </div>
        <ul className="ge-rowsheet">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className={`${btn} ge-rowsheetbtn`}
                aria-disabled={it.disabled || undefined}
                onClick={() => onPick(it.id)}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </SheetDialog>
  );
}
