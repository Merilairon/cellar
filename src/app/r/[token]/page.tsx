import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { PublicRecipeView } from '@/components/recipe/public/PublicRecipeView';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { getPublicRecipe } from '@/lib/recipes/public';

// Reads the DB per request: a revoked link must 404 at once, so nothing here may be cached.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

// `cache` dedupes the lookup between generateMetadata and the page within one request.
const lookupToken = cache((token: string) => getPublicRecipe(getDb(), token, getEnv()));
const lookup = async (params: Props['params']) => lookupToken((await params).token);

/**
 * `noindex, nofollow` on the page; a missing recipe returns no title so the 404 keeps the
 * shared not-found metadata and stays byte-identical across failure branches (R4).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const recipe = await lookup(params);
  return {
    ...(recipe ? { title: recipe.title } : {}),
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: Props) {
  const recipe = await lookup(params);
  if (!recipe) notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <PublicRecipeView recipe={recipe} />
    </main>
  );
}
