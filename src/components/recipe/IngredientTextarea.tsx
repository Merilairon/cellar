import { useTranslations } from 'next-intl';
import { parseIngredientLine, toIngredientFields } from '@/lib/import/ingredient-parser';
import { ingredientLines } from '@/lib/recipes/form-model';
import { FormField } from './FormField';
import { formatMeasure } from './formatIngredient';
import { input } from './styles';

/** One ingredient per line, with a live preview of how each line is understood. */
export function IngredientTextarea({
  id,
  value,
  onChange,
  code,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  code?: string;
}) {
  const t = useTranslations();
  const lines = ingredientLines(value);
  return (
    <div>
      <FormField
        id={id}
        label={t('recipe.form.ingredients')}
        hint={t('recipe.form.ingredientsHint')}
        code={code}
      >
        {(p) => (
          <textarea
            {...p}
            rows={Math.max(5, lines.length + 1)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${input} font-mono`}
            spellCheck={false}
          />
        )}
      </FormField>
      {lines.length > 0 && (
        <div className="mt-2">
          <h4 className="text-sm font-medium">{t('recipe.form.preview')}</h4>
          <ol className="mt-1 divide-y divide-neutral-200 rounded border border-neutral-300 text-sm dark:divide-neutral-700 dark:border-neutral-700">
            {lines.map((line, n) => {
              const parsed = parseIngredientLine(line);
              const f = toIngredientFields(parsed);
              const measure = formatMeasure(f);
              return (
                <li key={n} className="flex gap-2 px-2 py-1">
                  <span className="w-12 shrink-0 text-neutral-700 dark:text-neutral-300">
                    {t('recipe.form.row', { n: n + 1 })}
                  </span>
                  {parsed.unparsed ? (
                    <span>
                      {parsed.name}{' '}
                      <span className="text-amber-800 dark:text-amber-300">
                        ({t('recipe.form.unparsed')})
                      </span>
                    </span>
                  ) : (
                    <span>
                      {measure && <strong>{measure} </strong>}
                      {f.name}
                      {f.note && (
                        <em className="text-neutral-700 dark:text-neutral-300">, {f.note}</em>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
