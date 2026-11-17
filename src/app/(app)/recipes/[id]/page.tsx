import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RecipeActionSlot } from '@/components/recipe/RecipeActions';
import { RecipeMeta } from '@/components/recipe/RecipeMeta';
import { RecipeView } from '@/components/recipe/RecipeView';
import { Notes } from '@/components/recipe/notes/Notes';
import { PhotosPanel } from '@/components/recipe/photos/PhotosPanel';
import { PhotosProvider } from '@/components/recipe/photos/PhotosProvider';
import { RatingPanel } from '@/components/recipe/rating/RatingPanel';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { getUserById } from '@/lib/db/users';
import { listNotesFor } from '@/lib/recipes/notes';
import { isImportedUnedited } from '@/lib/recipes/access';
import { shareContext } from '@/lib/recipes/http';
import { getRecipeFor } from '@/lib/recipes/service';
import { notFoundMetadata } from '@/lib/page-meta';
import { contentTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
};

// One lookup per request for the title and the page; the same access check as the page, so a
// recipe the viewer cannot read gets the shared 404 title (and the page itself 404s).
const lookup = cache(async (id: string) => {
  const user = await getCurrentUser();
  if (!user) return null;
  const result = getRecipeFor(getDb(), user, id, shareContext());
  return result.ok ? { user, recipe: result.recipe } : null;
});

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const found = await lookup((await params).id);
  if (!found) return notFoundMetadata();
  const t = await getTranslations();
  return { title: contentTitle(found.recipe.title, t('meta.untitledRecipe')) };
}

export default async function Page({ params, searchParams }: Props) {
  const found = await lookup((await params).id);
  if (!found) notFound(); // not found and not visible look the same
  const { user, recipe } = found;
  const db = getDb();
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
            <RecipeActionSlot
              recipe={{
                id: recipe.id,
                title: recipe.title,
                can_edit: recipe.can_edit,
                visibility: recipe.visibility,
                share: recipe.share ? { url: recipe.share.url } : null,
                public_links_enabled: recipe.public_links_enabled,
                source_url: recipe.source_url,
                source_name: recipe.source_name,
              }}
              isOwner={isOwner}
              importedUnedited={isImportedUnedited({
                sourceUrl: recipe.source_url,
                createdAt: recipe.created_at,
                updatedAt: recipe.updated_at,
              })}
            />
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
