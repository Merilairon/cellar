import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { PublicRecipeView } from '@/components/recipe/public/PublicRecipeView';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { log } from '@/lib/log';
import { getPublicRecipe } from '@/lib/recipes/public';
import { notFoundMetadata } from '@/lib/page-meta';
import { contentTitle } from '@/lib/page-title';
import { getTranslations } from 'next-intl/server';

// Reads the DB per request: a revoked link must 404 at once, so nothing here may be cached.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

// `cache` dedupes the lookup between generateMetadata and the page within one request.
const lookupToken = cache((token: string) =>
  getPublicRecipe(getDb(), token, getEnv(), (recipeId) =>
    // After the response, so the log write never delays the page. Recipe id only, never the token.
    after(() => log('info', 'public_page.hit', { recipe_id: recipeId })),
  ),
);
const lookup = async (params: Props['params']) => lookupToken((await params).token);

/**
 * `noindex, nofollow` on the page and its recipe title; every miss returns the same fixed 404
 * title, so the branches stay identical (R4) and the browser does not replace the 404's title.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const recipe = await lookup(params);
  const robots = { index: false, follow: false };
  if (!recipe) return { ...(await notFoundMetadata()), robots };
  const untitled = (await getTranslations())('meta.untitledRecipe');
  return {
    title: contentTitle(recipe.title, untitled),
    robots,
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
