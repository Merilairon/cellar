'use client';

import { useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
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
import { btn, btnPrimary } from './styles';
import { PHONE_QUERY, useMediaQuery, useViewPreference } from './useViewPreference';

function EditorLoading() {
  const t = useTranslations();
  // Keep focus on something real while the chunk loads; the editor moves it to its heading.
  return (
    <p ref={(el) => el?.focus()} tabIndex={-1} role="status">
      {t('gridEditor.loading')}
    </p>
  );
}

// The editor is only needed after the owner asks for it, so it stays out of the page's
// initial bundle. Client-only: it never renders on the server.
const GridEditor = dynamic(() => import('./grid-editor/GridEditor').then((m) => m.GridEditor), {
  ssr: false,
  loading: () => <EditorLoading />,
});

export function RecipeView({
  recipe: serverRecipe,
  userId,
  unitPref = 'metric',
  actions,
}: {
  recipe: ApiRecipe;
  userId: string;
  unitPref?: UnitSystem;
  /** The page's action row (Edit, Delete, sharing, Save a copy); hidden while editing the grid. */
  actions?: React.ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  // T9 / G4: after a grid save the PUT response is the freshest data, so it is used at once;
  // `router.refresh()` then brings the server props (meta, page chrome) in line. The local copy
  // yields as soon as the server prop carries the same or a newer `updated_at`.
  const [saved, setSaved] = useState<ApiRecipe | null>(null);
  const recipe = saved && saved.updated_at > serverRecipe.updated_at ? saved : serverRecipe;
  const onRecipe = (r: ApiRecipe) => {
    setSaved(r);
    setSelected(null);
    router.refresh();
  };
  const root = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const [stored, setStored] = useViewPreference(userId);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const scale = useScale(unitPref, recipe.servings);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [justConverted, setJustConverted] = useState(false);
  const entry = useRef<HTMLButtonElement>(null);

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

  const canEditGrid = recipe.can_edit && gridPossible;
  const openEditor = () => {
    setSelected(null);
    setJustConverted(false);
    setEditing(true);
  };
  const closeEditor = () => {
    setEditing(false);
    // Back to the read view: focus returns to the button that opened the editor.
    requestAnimationFrame(() => entry.current?.focus());
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

  // Edit mode replaces the read view and hides the scale, unit and view controls: the editor
  // shows quantities as stored, never a scaled or converted number (UX spec F3).
  if (editing)
    return (
      <div ref={root}>
        <GridEditor recipe={recipe} onClose={closeEditor} onRecipe={onRecipe} />
      </div>
    );

  return (
    <div ref={root}>
      {actions !== undefined && (
        <div className="my-4 flex flex-wrap items-center gap-2">
          {actions}
          {canEditGrid && (
            <button ref={entry} type="button" className={btn} onClick={openEditor}>
              {t('gridEditor.entry.edit')}
            </button>
          )}
        </div>
      )}
      {justConverted && canEditGrid && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-2">
          {t('gridEditor.entry.savedAsGrid')}
          <button type="button" className={btnPrimary} onClick={openEditor}>
            {t('gridEditor.entry.fineTune')}
          </button>
        </p>
      )}
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
        <ConvertToGrid
          recipe={recipe}
          onConverted={() => {
            choose('grid');
            setJustConverted(true);
          }}
        />
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
