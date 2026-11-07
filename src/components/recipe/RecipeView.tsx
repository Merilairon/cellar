'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UnitSystem } from '@/lib/units/units';
import type { ViewMode } from '@/lib/recipes/schemas';
import { effectiveViewMode, maxColumnsInSection } from '@/lib/recipes/view-mode';
import { ConvertToGrid } from './ConvertToGrid';
import { ScaleControls, useScale } from './ScaleControls';
import { RecipeGrid } from './RecipeGrid';
import { RecipeList } from './RecipeList';
import { StepSheet } from './StepDetail';
import type { ApiRecipe } from './types';
import { PHONE_QUERY, useMediaQuery, useViewPreference } from './useViewPreference';

export function RecipeView({
  recipe,
  userId,
  unitPref = 'metric',
}: {
  recipe: ApiRecipe;
  userId: string;
  unitPref?: UnitSystem;
}) {
  const t = useTranslations();
  const root = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const [stored, setStored] = useViewPreference(userId);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const scale = useScale(unitPref, recipe.servings);
  const [selected, setSelected] = useState<string | null>(null);

  const gridPossible = recipe.view_mode === 'grid';
  const mode = effectiveViewMode({
    recipeViewMode: recipe.view_mode,
    stored,
    maxColumnsInSection: maxColumnsInSection(recipe.sections),
    isPhone,
  });
  const selectedStep =
    recipe.sections.flatMap((s) => s.steps).find((s) => s.id === selected) ?? null;

  const choose = (m: ViewMode) => {
    setSelected(null);
    setStored(m);
  };

  const closeStep = () => {
    if (!selected) return;
    const id = selected;
    setSelected(null);
    // Give focus back to the cell that opened the detail.
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`[data-step-id="${id}"]`)?.focus(),
    );
  };

  const toggle = (m: ViewMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      disabled={m === 'grid' && !gridPossible}
      aria-describedby={m === 'grid' && !gridPossible ? noteId : undefined}
      onClick={() => choose(m)}
      className="min-h-11 border-r border-neutral-500 px-4 last:border-r-0 disabled:opacity-50 aria-pressed:bg-emerald-700 aria-pressed:text-white"
    >
      {label}
    </button>
  );

  return (
    <div ref={root}>
      <ScaleControls scale={scale} servings={recipe.servings} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={t('recipe.view.label')}
          className="inline-flex overflow-hidden rounded border border-neutral-500"
        >
          {toggle('grid', t('recipe.view.grid'))}
          {toggle('list', t('recipe.view.list'))}
        </div>
        {!gridPossible && (
          <p id={noteId} className="text-sm text-neutral-700 dark:text-neutral-300">
            {t(
              recipe.can_edit ? 'recipe.view.gridUnavailableOwner' : 'recipe.view.gridUnavailable',
            )}
          </p>
        )}
      </div>

      {mode === 'list' && !gridPossible && recipe.can_edit && (
        <ConvertToGrid recipe={recipe} onConverted={() => choose('grid')} />
      )}

      {mode === 'grid' ? (
        <>
          <RecipeGrid
            sections={recipe.sections}
            recipeTitle={recipe.title}
            expandedStepId={selected}
            onSelectStep={setSelected}
            detailMode={isPhone ? 'sheet' : 'inline'}
            display={scale.display}
          />
          {isPhone && <StepSheet step={selectedStep} onClose={closeStep} />}
        </>
      ) : (
        <RecipeList sections={recipe.sections} display={scale.display} />
      )}
    </div>
  );
}
