'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatQty } from '@/lib/units/display';
import type { QuantityDisplay } from '../IngredientCell';
import { RecipeGrid } from '../RecipeGrid';
import { SheetDialog } from '../SheetDialog';
import { StepSheet } from '../StepDetail';
import type { ApiRecipe } from '../types';
import { PHONE_QUERY, useMediaQuery } from '../useViewPreference';
import { cookProgress, cookTotals, ingredientKey, stepKey, toggleKey } from './cook-state';
import { browserHistoryEnv, createCookHistory } from './cook-history';
import { CookList } from './CookList';
import { useWakeLock } from './useWakeLock';

/**
 * Full-screen cook mode (T10, UX spec section 6): a modal dialog over the recipe page, not a
 * route. Scale and units are frozen at open. Checkbox state lives only here (Q8, G6).
 */
export function CookMode({
  recipe,
  display,
  mode,
  onClose,
}: {
  recipe: ApiRecipe;
  display: QuantityDisplay;
  /** What the page shows: a grid recipe in grid mode, otherwise lists. */
  mode: 'grid' | 'list';
  onClose: () => void;
}) {
  const t = useTranslations();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const wake = useWakeLock();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = useCallback((key: string) => setChecked((prev) => toggleKey(prev, key)), []);

  // History entry: Back closes. The push waits one tick so a strict-mode remount (which runs
  // the cleanup at once) never pushes twice.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const histRef = useRef<ReturnType<typeof createCookHistory> | null>(null);
  useEffect(() => {
    const h = createCookHistory(browserHistoryEnv, () => closeRef.current());
    histRef.current = h;
    const timer = window.setTimeout(() => h.open(), 0);
    const onPop = () => h.pop();
    window.addEventListener('popstate', onPop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
      h.detach();
      histRef.current = null;
    };
  }, []);
  const requestClose = () => (histRef.current ? histRef.current.request() : onClose());

  const closeStep = () => {
    if (!selected) return;
    const id = selected;
    setSelected(null);
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`[data-step-id="${id}"]`)?.focus(),
    );
  };
  const selectedStep = recipe.sections.flatMap((s) => s.steps).find((s) => s.id === selected);

  const totals = cookTotals(recipe.sections);
  const done = cookProgress(checked);
  const scaleLine = [
    display.scale !== 1 ? t('cook.scale', { n: formatQty(display.scale) }) : null,
    display.toggle ? t(display.toggle === 'us' ? 'cook.units.us' : 'cook.units.metric') : null,
  ]
    .filter(Boolean)
    .join(', ');

  const box = (key: string, label?: string) => (
    <input
      type="checkbox"
      className="ck-box"
      aria-label={label}
      checked={checked.has(key)}
      onChange={() => toggle(key)}
    />
  );

  return (
    <SheetDialog
      open
      onClose={requestClose}
      labelledBy={titleId}
      className="ck-dialog"
      initialFocus={(d) => d.querySelector<HTMLElement>(`[id="${CSS.escape(titleId)}"]`)}
    >
      <div
        ref={root}
        className="ck-root"
        onKeyDown={(e) => {
          // Escape closes an open inline step panel first; the next press closes cook mode.
          if (e.key === 'Escape' && selected && !isPhone) {
            e.preventDefault();
            e.stopPropagation();
            closeStep();
          }
        }}
      >
        <div className="ck-bar">
          <h2 id={titleId} tabIndex={-1} className="ck-title" title={recipe.title}>
            {t('cook.heading', { title: recipe.title })}
          </h2>
          <button type="button" className="ck-close" onClick={requestClose}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            {t('cook.close')}
          </button>
        </div>
        <div className="ck-info">
          <p>
            {t('cook.progress', {
              i: done.ingredients,
              n: totals.ingredients,
              j: done.steps,
              m: totals.steps,
            })}
          </p>
          {scaleLine && <p>{scaleLine}</p>}
          <p role="status" className="ck-wake">
            {wake === 'on' && t('cook.wake.on')}
            {wake === 'unsupported' && t('cook.wake.unsupported')}
            {wake === 'failed' && t('cook.wake.failed')}
          </p>
        </div>
        <div className="ck-body">
          {mode === 'grid' ? (
            <>
              <RecipeGrid
                sections={recipe.sections}
                recipeTitle={recipe.title}
                display={display}
                expandedStepId={selected}
                onSelectStep={setSelected}
                detailMode={isPhone ? 'sheet' : 'inline'}
                stepTarget="button"
                renderIngredientLead={({ sectionIndex, rowIndex }) =>
                  box(ingredientKey(sectionIndex, rowIndex))
                }
                renderStepLead={({ sectionIndex, stepIndex, step }) => (
                  <label className="ck-strip">
                    {box(
                      stepKey(sectionIndex, stepIndex),
                      t('cook.step.check', { label: step.label }),
                    )}
                  </label>
                )}
              />
              {isPhone && <StepSheet step={selectedStep ?? null} onClose={closeStep} />}
            </>
          ) : (
            <CookList
              sections={recipe.sections}
              display={display}
              checked={checked}
              onToggle={toggle}
            />
          )}
        </div>
      </div>
    </SheetDialog>
  );
}
