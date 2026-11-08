import { useTranslations } from 'next-intl';
import { formatStepParams, type StepT } from '../formatStep';
import { IngredientCell, type QuantityDisplay } from '../IngredientCell';
import type { ApiSection } from '../types';
import { ingredientKey, stepKey } from './cook-state';

/** Cook mode for list-view recipes: per section an Ingredients and a numbered Steps list. */
export function CookList({
  sections,
  display,
  checked,
  onToggle,
}: {
  sections: ApiSection[];
  display?: QuantityDisplay;
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const t = useTranslations();
  const stepT: StepT = (key, values) => t(key, values);
  const multiple = sections.length > 1;
  const byPos = <T extends { position: number }>(xs: T[]) =>
    [...xs].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, si) => {
        const title = section.title || (multiple ? t('recipe.section', { n: si + 1 }) : null);
        const Sub = title ? 'h3' : 'h2';
        const steps = byPos(section.steps);
        const ordered = [
          ...steps.filter((s) => s.kind === 'banner_top'),
          ...steps.filter((s) => s.kind === 'column'),
          ...steps.filter((s) => s.kind === 'banner_bottom'),
        ];
        let lastGroup: string | null = null;
        return (
          <section key={section.id}>
            {title && <h2 className="ck-sectitle">{title}</h2>}
            <Sub className="font-semibold">{t('cook.list.ingredients')}</Sub>
            <ul className="ck-list">
              {byPos(section.ingredients).map((ing, r) => {
                const heading = ing.group_label && ing.group_label !== lastGroup;
                lastGroup = ing.group_label;
                const key = ingredientKey(si, r);
                return (
                  <li key={ing.id}>
                    {heading && <p className="font-medium">{ing.group_label}</p>}
                    <label className="ck-item" data-checked={checked.has(key)}>
                      <input
                        type="checkbox"
                        className="ck-box"
                        checked={checked.has(key)}
                        onChange={() => onToggle(key)}
                      />
                      <span>
                        <IngredientCell ingredient={ing} display={display} />
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <Sub className="mt-4 font-semibold">{t('cook.list.steps')}</Sub>
            <ol className="ck-list">
              {ordered.map((s, n) => {
                const params = formatStepParams(s, stepT);
                const key = stepKey(si, section.steps.indexOf(s));
                return (
                  <li key={s.id}>
                    <label className="ck-item" data-checked={checked.has(key)}>
                      <span className="ck-strip">
                        <input
                          type="checkbox"
                          className="ck-box"
                          checked={checked.has(key)}
                          onChange={() => onToggle(key)}
                        />
                      </span>
                      <span>
                        <span className="ck-num">{n + 1}. </span>
                        {s.detail || s.label}
                        {params && <span className="rg-parinline"> ({params})</span>}
                      </span>
                    </label>
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
