'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { formatStepParams, type StepT } from './formatStep';
import { SheetDialog } from './SheetDialog';
import type { ApiStep } from './types';

function useStepT(): StepT {
  const t = useTranslations();
  return (key, values) => t(key, values);
}

/** Inline expansion (>= 640 px): rendered under the section's table, announced politely. */
export function StepPanel({ step, onClose }: { step: ApiStep; onClose: () => void }) {
  const t = useTranslations();
  const params = formatStepParams(step, useStepT());
  return (
    <div className="rg-panel">
      <p className="font-semibold">
        {step.label}
        {params && <span className="rg-parinline"> {params}</span>}
      </p>
      <p className="mt-1 whitespace-pre-line">{step.detail || t('recipe.step.noDetail')}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 min-h-10 rounded border border-current px-3 text-sm"
      >
        {t('recipe.step.close')}
      </button>
    </div>
  );
}

/** Bottom sheet (< 640 px) on a native modal dialog: focus trap, Esc and backdrop close. */
export function StepSheet({ step, onClose }: { step: ApiStep | null; onClose: () => void }) {
  const t = useTranslations();
  const params = formatStepParams(
    step ?? { temp_c: null, temp_f: null, minutes_min: null, minutes_max: null },
    useStepT(),
  );
  const titleId = useId();

  return (
    <SheetDialog open={step !== null} onClose={onClose} labelledBy={titleId}>
      <div className="rg-sheet-body">
        {step && (
          <>
            <h2 id={titleId} className="text-lg font-semibold">
              {step.label}
              {params && <span className="rg-parinline"> {params}</span>}
            </h2>
            <p className="mt-2 whitespace-pre-line">{step.detail || t('recipe.step.noDetail')}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 min-h-11 w-full rounded border border-current px-3"
            >
              {t('recipe.step.close')}
            </button>
          </>
        )}
      </div>
    </SheetDialog>
  );
}
