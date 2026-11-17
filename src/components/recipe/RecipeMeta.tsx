import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { safeHttpUrl } from './api';
import type { ApiRecipe } from './types';

type MetaKeys =
  | 'servings'
  | 'servings_label'
  | 'prep_minutes'
  | 'cook_minutes'
  | 'source_url'
  | 'source_name'
  | 'tags'
  | 'description';
type MetaRecipe = Pick<ApiRecipe, MetaKeys>;

/**
 * `linkTags` and `showSource` default to the signed-in recipe page's behaviour. The public page
 * passes `false` for both: a tag link would send a guest to the login page, and the source
 * banner already carries the source (UX spec F1).
 */
export function RecipeMeta({
  recipe,
  linkTags = true,
  showSource = true,
}: {
  recipe: MetaRecipe;
  linkTags?: boolean;
  showSource?: boolean;
}) {
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
    <div className="mt-2 text-neutral-700 print:flex print:flex-col dark:text-neutral-300">
      {facts.length > 0 && <p>{facts.join(' · ')}</p>}
      {showSource && sourceText && (
        // On paper the source line comes before the facts line (UX spec 4.1 items 2 and 3).
        <p className="print:order-first">
          {t('recipe.meta.source')}{' '}
          {safeUrl ? (
            <a href={safeUrl} rel="noopener noreferrer" className="print-url underline">
              {sourceText}
            </a>
          ) : (
            sourceText
          )}
        </p>
      )}
      {recipe.tags.length > 0 && (
        <ul aria-label={t('tags.view.label')} className="mt-2 flex flex-wrap gap-2 print:hidden">
          {recipe.tags.map((name) => (
            <li key={name}>
              {linkTags ? (
                <Link
                  href={`/recipes?tag=${encodeURIComponent(name)}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-neutral-500 px-3 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {name}
                </Link>
              ) : (
                <span className="inline-flex min-h-9 items-center rounded-full border border-neutral-500 px-3">
                  {name}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {recipe.tags.length > 0 && (
        <p className="hidden print:block">{t('print.tags', { list: recipe.tags.join(', ') })}</p>
      )}
      {recipe.description && <p className="mt-2 whitespace-pre-line">{recipe.description}</p>}
    </div>
  );
}
