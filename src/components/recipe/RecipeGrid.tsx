import { useTranslations } from 'next-intl';
import { buildSectionLayout } from '@/lib/grid/layout';
import { formatStepParams, type StepT } from './formatStep';
import { IngredientCell } from './IngredientCell';
import { ScrollRegion } from './ScrollRegion';
import { StepPanel } from './StepDetail';
import type { ApiSection, ApiStep } from './types';

export type RecipeGridProps = {
  sections: ApiSection[];
  /** Used for the table caption when a section has no title. */
  recipeTitle: string;
  expandedStepId?: string | null;
  /** Called with the step id to expand, or null to collapse. */
  onSelectStep?: (stepId: string | null) => void;
  /**
   * `inline`: the detail panel renders under the section's table.
   * `sheet`: the parent shows a bottom sheet; cells then announce a dialog popup.
   */
  detailMode?: 'inline' | 'sheet';
};

/** Props in, markup out. One real <table> per section. */
export function RecipeGrid({
  sections,
  recipeTitle,
  expandedStepId = null,
  onSelectStep,
  detailMode = 'inline',
}: RecipeGridProps) {
  const t = useTranslations();
  const stepT: StepT = (key, values) => t(key, values);
  const multiple = sections.length > 1;

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, si) => {
        const layout = buildSectionLayout(section.ingredients.length, section.steps);
        const title = section.title || (multiple ? t('recipe.section', { n: si + 1 }) : null);
        const name = title ?? recipeTitle;
        const ingredients = [...section.ingredients].sort((a, b) => a.position - b.position);
        const colSpan = layout.columns.length + 1;
        const detailId = `rg-detail-${section.id}`;
        const expanded = layout.columns.find((c) => c.step.id === expandedStepId)?.step ?? null;

        const banner = (s: ApiStep) => {
          const params = formatStepParams(s, stepT);
          return (
            <tr key={s.id}>
              <td colSpan={colSpan} className="rg-banner">
                <div className="rg-bn">
                  {s.detail || s.label}
                  {params && <span className="rg-parinline"> {params}</span>}
                </div>
              </td>
            </tr>
          );
        };

        return (
          <section key={section.id}>
            {title && (
              <h2 className="mb-2 text-lg font-semibold text-emerald-800 dark:text-emerald-400">
                {title}
              </h2>
            )}
            <ScrollRegion
              label={t('recipe.grid.region', { title: name })}
              stepCount={layout.columns.length}
            >
              <table className="rg-table">
                <caption className="sr-only">{t('recipe.grid.caption', { title: name })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('recipe.grid.ingredientsHeader')}</th>
                    {layout.columns.map((c) => (
                      <th key={c.step.id} scope="col">
                        {t('recipe.grid.stepHeader', { n: c.columnIndex + 1, label: c.step.label })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {layout.bannersTop.map(banner)}
                  {ingredients.map((ing, r) => (
                    <tr key={ing.id}>
                      <th scope="row" className="rg-ing">
                        <IngredientCell ingredient={ing} />
                      </th>
                      {layout.rows[r].map((cell) => {
                        if (cell.type === 'empty') {
                          return <td key={`e${cell.columnIndex}`} className="rg-empty" />;
                        }
                        const c = cell.column;
                        const step = c.step;
                        const open = step.id === expandedStepId;
                        const params = formatStepParams(step, stepT);
                        return (
                          // The td takes the click so the whole cell is a target; the inner
                          // button is the keyboard stop and its click bubbles up to here.
                          <td
                            key={step.id}
                            rowSpan={c.rowSpan}
                            className="rg-step"
                            data-selected={open}
                            onClick={() => onSelectStep?.(open ? null : step.id)}
                          >
                            <button
                              type="button"
                              className="rg-stepbtn"
                              data-step-id={step.id}
                              aria-expanded={detailMode === 'inline' ? open : undefined}
                              aria-controls={detailMode === 'inline' ? detailId : undefined}
                              aria-haspopup={detailMode === 'sheet' ? 'dialog' : undefined}
                            >
                              <span className="rg-lbl">{step.label}</span>
                              {params && <span className="rg-par">{params}</span>}
                              <span className="sr-only">
                                {c.rowStart === c.rowEnd
                                  ? t('recipe.grid.stepRow', {
                                      name: ingredients[c.rowStart]?.name ?? '',
                                    })
                                  : t('recipe.grid.stepRows', {
                                      from: ingredients[c.rowStart]?.name ?? '',
                                      to: ingredients[c.rowEnd]?.name ?? '',
                                    })}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {layout.bannersBottom.map(banner)}
                </tbody>
              </table>
            </ScrollRegion>
            <div id={detailId} className="rg-detail" aria-live="polite">
              {detailMode === 'inline' && expanded && (
                <StepPanel step={expanded} onClose={() => onSelectStep?.(null)} />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
