'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicRecipe } from '@/lib/recipes/public';
import type { ViewMode } from '@/lib/recipes/schemas';
import { effectiveViewMode, maxColumnsInSection } from '@/lib/recipes/view-mode';
import { RecipeGrid } from '../RecipeGrid';
import { RecipeList } from '../RecipeList';
import { RecipeMeta } from '../RecipeMeta';
import { ScaleControls, useScale } from '../ScaleControls';
import { PrintButton } from '../print/PrintButton';
import { StepSheet } from '../StepDetail';
import { PHONE_QUERY, useMediaQuery } from '../useViewPreference';
import { SourceBanner } from './SourceBanner';

/**
 * Read-only recipe for an anonymous visitor of a share link (R11, UX spec section 3). It holds
 * only view state: scale, units (metric first), grid/list. Nothing is persisted (no
 * localStorage, no cookies), nothing calls the API, nothing refreshes the router, and the
 * `PublicRecipe` type carries no notes, ratings, photos, ids or share state to render.
 */
export function PublicRecipeView({ recipe }: { recipe: PublicRecipe }) {
  const t = useTranslations();
  const root = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const scale = useScale('metric', recipe.servings);
  // Component state only: `null` until the visitor chooses, then the default rule applies.
  const [chosen, setChosen] = useState<ViewMode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const gridPossible = recipe.view_mode === 'grid';
  const mode = effectiveViewMode({
    recipeViewMode: recipe.view_mode,
    stored: chosen,
    maxColumnsInSection: maxColumnsInSection(recipe.sections),
    isPhone,
  });
  const selectedStep =
    recipe.sections.flatMap((s) => s.steps).find((s) => s.id === selected) ?? null;

  const choose = (m: ViewMode) => {
    setSelected(null);
    setChosen(m);
  };
  const closeStep = () => {
    if (!selected) return;
    const id = selected;
    setSelected(null);
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
      <h1 className="text-2xl font-bold">{recipe.title}</h1>
      <SourceBanner sourceUrl={recipe.source_url} sourceName={recipe.source_name} />
      <RecipeMeta recipe={recipe} linkTags={false} showSource={false} />
      <div className="mt-4">
        <ScaleControls scale={scale} servings={recipe.servings} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
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
            {t('recipe.view.gridUnavailable')}
          </p>
        )}
        <PrintButton />
      </div>

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
      <p className="mt-8 border-t print:hidden border-neutral-500 pt-4 text-center text-neutral-700 dark:text-neutral-300">
        {t('publicPage.footer')}
      </p>
    </div>
  );
}
