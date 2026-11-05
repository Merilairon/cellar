import { useTranslations } from 'next-intl';
import { safeHttpUrl } from './api';
import type { ApiRecipe } from './types';

export function RecipeMeta({ recipe }: { recipe: ApiRecipe }) {
  const t = useTranslations();
  const facts: string[] = [];
  if (recipe.servings != null) {
    facts.push(
      recipe.servings_label
        ? t('recipe.meta.servingsLabeled', {
            amount: recipe.servings,
            label: recipe.servings_label,
          })
        : t('recipe.meta.servings', { amount: recipe.servings }),
    );
  }
  if (recipe.prep_minutes != null)
    facts.push(t('recipe.meta.prep', { minutes: recipe.prep_minutes }));
  if (recipe.cook_minutes != null)
    facts.push(t('recipe.meta.cook', { minutes: recipe.cook_minutes }));

  const safeUrl = safeHttpUrl(recipe.source_url);
  const sourceText = recipe.source_name || safeUrl;

  return (
    <div className="mt-2 text-neutral-700 dark:text-neutral-300">
      {facts.length > 0 && <p>{facts.join(' · ')}</p>}
      {sourceText && (
        <p>
          {t('recipe.meta.source')}{' '}
          {safeUrl ? (
            <a href={safeUrl} rel="noopener noreferrer" className="underline">
              {sourceText}
            </a>
          ) : (
            sourceText
          )}
        </p>
      )}
      {recipe.description && <p className="mt-2 whitespace-pre-line">{recipe.description}</p>}
    </div>
  );
}
