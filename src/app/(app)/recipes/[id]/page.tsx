import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { OwnerActions, SaveCopyButton, VisibilityControl } from '@/components/recipe/RecipeActions';
import { RecipeMeta } from '@/components/recipe/RecipeMeta';
import { RecipeView } from '@/components/recipe/RecipeView';
import { Notes } from '@/components/recipe/notes/Notes';
import { PhotosPanel } from '@/components/recipe/photos/PhotosPanel';
import { PhotosProvider, PhotosToggle } from '@/components/recipe/photos/PhotosProvider';
import { RatingPanel } from '@/components/recipe/rating/RatingPanel';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { getUserById } from '@/lib/db/users';
import { listNotesFor } from '@/lib/recipes/notes';
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
  const notes = listNotesFor(db, user, recipe.id);
  const t = await getTranslations();
  const coverFailed = (await searchParams).notice === 'cover_failed';
  const isOwner = recipe.owner_id === user.id;
  const ownerName = isOwner ? null : (getUserById(db, recipe.owner_id)?.displayName ?? '');

  return (
    <main>
      <PhotosProvider
        recipeId={recipe.id}
        title={recipe.title}
        canEdit={recipe.can_edit}
        initialPhotos={recipe.photos}
      >
        <div className="lg:grid lg:grid-cols-[1fr_20rem] lg:items-start lg:gap-6">
          <div>
            <h1 className="text-2xl font-bold">{recipe.title}</h1>
            <RecipeMeta recipe={recipe} />
            <RatingPanel
              recipeId={recipe.id}
              initial={{
                avg: recipe.rating_avg,
                count: recipe.rating_count,
                mine: recipe.my_rating,
              }}
            />
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
          </div>
          <div className="mt-4 lg:mt-0">
            <PhotosPanel />
          </div>
        </div>
        <RecipeView
          recipe={recipe}
          userId={user.id}
          unitPref={user.unitPref}
          actions={
            <>
              {recipe.can_edit && <OwnerActions id={recipe.id} />}
              {recipe.can_edit && <PhotosToggle />}
              {recipe.can_edit && (
                <VisibilityControl id={recipe.id} visibility={recipe.visibility} />
              )}
              {!isOwner && <SaveCopyButton id={recipe.id} />}
            </>
          }
        />
        <Notes
          recipeId={recipe.id}
          canManage={recipe.can_edit}
          initialNotes={notes.ok ? notes.notes : []}
        />
      </PhotosProvider>
    </main>
  );
}
