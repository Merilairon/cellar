import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { OwnerActions, SaveCopyButton, VisibilityControl } from '@/components/recipe/RecipeActions';
import { RecipeMeta } from '@/components/recipe/RecipeMeta';
import { RecipeView } from '@/components/recipe/RecipeView';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { getUserById } from '@/lib/db/users';
import { getRecipeFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) notFound(); // the (app) layout already redirects; this narrows the type
  const db = getDb();
  const result = getRecipeFor(db, user, (await params).id);
  if (!result.ok) notFound(); // not found and not visible look the same
  const recipe = result.recipe;
  const t = await getTranslations();
  const coverFailed = (await searchParams).notice === 'cover_failed';
  const isOwner = recipe.owner_id === user.id;
  const ownerName = isOwner ? null : (getUserById(db, recipe.owner_id)?.displayName ?? '');

  return (
    <main>
      <h1 className="text-2xl font-bold">{recipe.title}</h1>
      <RecipeMeta recipe={recipe} />
      {coverFailed && (
        <p
          role="status"
          className="mt-3 rounded border border-amber-700 p-3 text-amber-900 dark:border-amber-400 dark:text-amber-200"
        >
          {t('import.review.coverFailed')}
        </p>
      )}
      {!isOwner && (
        <p className="mt-3 rounded bg-neutral-100 p-3 dark:bg-neutral-800">
          {t('recipe.sharedNotice', { name: ownerName ?? '' })}
        </p>
      )}
      <div className="my-4 flex flex-wrap items-center gap-2">
        {recipe.can_edit && <OwnerActions id={recipe.id} />}
        {recipe.can_edit && <VisibilityControl id={recipe.id} visibility={recipe.visibility} />}
        {!isOwner && <SaveCopyButton id={recipe.id} />}
      </div>
      <RecipeView recipe={recipe} userId={user.id} />
    </main>
  );
}
