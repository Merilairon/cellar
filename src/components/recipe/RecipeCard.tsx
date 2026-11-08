import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { CoverImage } from './photos/CoverImage';
import { CardRating } from './rating/RatingSummary';

export type RecipeCardData = {
  id: string;
  title: string;
  owner_display_name: string;
  is_owner: boolean;
  visibility: 'private' | 'users';
  updated_at: string;
  tags: string[];
  cover_photo_id?: string | null;
  rating_avg?: number | null;
  rating_count?: number;
};

export function RecipeCard({ recipe }: { recipe: RecipeCardData }) {
  const t = useTranslations();
  const format = useFormatter();
  return (
    <li className="overflow-hidden rounded border border-neutral-300 hover:border-emerald-700 dark:border-neutral-700">
      <Link href={`/recipes/${recipe.id}`} className="block h-full rounded">
        {/* Decorative: the link's name is the title (rule R3). The box is always rendered so card heights stay even. */}
        <CoverImage
          photoId={recipe.cover_photo_id ?? null}
          thumb
          alt=""
          width={400}
          height={300}
          box="aspect-[4/3] w-full"
        />
        <div className="p-4">
          <h2 className="text-lg font-semibold">{recipe.title}</h2>
          <CardRating avg={recipe.rating_avg ?? null} count={recipe.rating_count ?? 0} />
          {!recipe.is_owner && (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {t('recipes.sharedBy', { name: recipe.owner_display_name })}
            </p>
          )}
          {recipe.tags.length > 0 ? (
            <ul aria-label={t('tags.field.listLabel')} className="mt-2 flex flex-wrap gap-1">
              {recipe.tags.map((name) => (
                <li
                  key={name}
                  className="rounded border border-neutral-500 px-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-300"
                >
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
              {t('recipes.noTags')}
            </p>
          )}
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {t('recipes.updated', {
              date: format.dateTime(new Date(recipe.updated_at), { dateStyle: 'medium' }),
            })}
            {recipe.is_owner && recipe.visibility === 'users' && ` · ${t('recipes.sharedBadge')}`}
          </p>
        </div>
      </Link>
    </li>
  );
}
