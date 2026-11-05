import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

export type RecipeCardData = {
  id: string;
  title: string;
  owner_display_name: string;
  is_owner: boolean;
  visibility: 'private' | 'users';
  updated_at: string;
};

export function RecipeCard({ recipe }: { recipe: RecipeCardData }) {
  const t = useTranslations();
  const format = useFormatter();
  return (
    <li className="rounded border border-neutral-300 hover:border-emerald-700 dark:border-neutral-700">
      <Link href={`/recipes/${recipe.id}`} className="block h-full rounded p-4">
        <h2 className="text-lg font-semibold">{recipe.title}</h2>
        {!recipe.is_owner && (
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            {t('recipes.sharedBy', { name: recipe.owner_display_name })}
          </p>
        )}
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{t('recipes.noTags')}</p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {t('recipes.updated', {
            date: format.dateTime(new Date(recipe.updated_at), { dateStyle: 'medium' }),
          })}
          {recipe.is_owner && recipe.visibility === 'users' && ` · ${t('recipes.sharedBadge')}`}
        </p>
      </Link>
    </li>
  );
}
