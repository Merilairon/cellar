import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { notFoundMetadata, titleFromCatalog } from '@/lib/page-meta';
import { getTranslations } from 'next-intl/server';
import { RecipeForm } from '@/components/recipe/RecipeForm';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { formFromRecipe } from '@/lib/recipes/form-model';
import { shareContext } from '@/lib/recipes/http';
import { getRecipeFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await getCurrentUser();
  const result = user ? getRecipeFor(getDb(), user, (await params).id, shareContext()) : null;
  // The same test as the page: unreadable and read-only recipes are the shared 404.
  return result?.ok && result.recipe.can_edit
    ? titleFromCatalog('recipe.form.editTitle')
    : notFoundMetadata();
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) notFound();
  const { id } = await params;
  const result = getRecipeFor(getDb(), user, id, shareContext());
  // Unreadable and read-only recipes both look like a missing page.
  if (!result.ok || !result.recipe.can_edit) notFound();
  const t = await getTranslations();
  return (
    <main>
      <h1 className="mb-4 text-2xl font-bold">{t('recipe.form.editTitle')}</h1>
      <RecipeForm recipeId={id} initial={formFromRecipe(result.recipe)} />
    </main>
  );
}
