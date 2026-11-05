import { getTranslations } from 'next-intl/server';
import { RecipeForm } from '@/components/recipe/RecipeForm';

export default async function Page() {
  const t = await getTranslations();
  return (
    <main>
      <h1 className="mb-4 text-2xl font-bold">{t('recipe.form.newTitle')}</h1>
      <RecipeForm />
    </main>
  );
}
