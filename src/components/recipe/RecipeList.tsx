import { useTranslations } from 'next-intl';
import { formatStepParams, type StepT } from './formatStep';
import { IngredientCell } from './IngredientCell';
import type { ApiSection } from './types';

/** Props in, markup out: ingredients plus numbered steps per section. */
export function RecipeList({ sections }: { sections: ApiSection[] }) {
  const t = useTranslations();
  const stepT: StepT = (key, values) => t(key, values);
  const multiple = sections.length > 1;

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, si) => {
        const title = section.title || (multiple ? t('recipe.section', { n: si + 1 }) : null);
        const byPos = <T extends { position: number }>(xs: T[]) =>
          [...xs].sort((a, b) => a.position - b.position);
        const steps = byPos(section.steps);
        const ordered = [
          ...steps.filter((s) => s.kind === 'banner_top'),
          ...steps.filter((s) => s.kind === 'column'),
          ...steps.filter((s) => s.kind === 'banner_bottom'),
        ];
        // No h2 for an untitled single section: keep the heading order h1 > h2.
        const Sub = title ? 'h3' : 'h2';
        let lastGroup: string | null = null;
        return (
          <section key={section.id}>
            {title && (
              <h2 className="mb-2 text-lg font-semibold text-emerald-800 dark:text-emerald-400">
                {title}
              </h2>
            )}
            <Sub className="font-semibold">{t('recipe.list.ingredients')}</Sub>
            <ul className="mt-1 list-disc pl-5">
              {byPos(section.ingredients).map((ing) => {
                const heading = ing.group_label && ing.group_label !== lastGroup;
                lastGroup = ing.group_label;
                return (
                  <li key={ing.id} className="my-1">
                    {heading && <p className="font-medium">{ing.group_label}</p>}
                    <IngredientCell ingredient={ing} />
                  </li>
                );
              })}
            </ul>
            <Sub className="mt-4 font-semibold">{t('recipe.list.steps')}</Sub>
            <ol className="mt-1 list-decimal pl-6">
              {ordered.map((s) => {
                const params = formatStepParams(s, stepT);
                return (
                  <li key={s.id} className="my-1">
                    {s.detail || s.label}
                    {params && <span className="rg-parinline"> ({params})</span>}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
