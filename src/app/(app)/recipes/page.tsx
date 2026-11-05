import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { btn, btnPrimary } from '@/components/recipe/styles';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { listRecipes } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  const t = await getTranslations();
  const recipes = user ? listRecipes(getDb(), user) : [];
  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('recipes.title')}</h1>
        {recipes.length > 0 && (
          <Link href="/recipes/new" className={btnPrimary}>
            {t('recipes.create')}
          </Link>
        )}
      </div>
      {recipes.length === 0 ? (
        <section className="mt-6 rounded border border-dashed border-neutral-400 p-6 text-center">
          <h2 className="text-lg font-semibold">{t('recipes.emptyTitle')}</h2>
          <p className="mt-1 text-neutral-700 dark:text-neutral-300">{t('recipes.empty')}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/recipes/new" className={btnPrimary}>
              {t('recipes.create')}
            </Link>
            <Link href="/import" className={btn}>
              {t('recipes.import')}
            </Link>
          </div>
        </section>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={{
                id: r.id,
                title: r.title,
                owner_display_name: r.owner_display_name,
                is_owner: r.owner_id === user?.id,
                visibility: r.visibility,
                updated_at: r.updated_at,
              }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
