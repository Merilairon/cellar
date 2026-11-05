import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RecipeForm } from '@/components/recipe/RecipeForm';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { formFromRecipe } from '@/lib/recipes/form-model';
import { getRecipeFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) notFound();
  const { id } = await params;
  const result = getRecipeFor(getDb(), user, id);
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
