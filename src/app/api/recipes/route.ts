import { getDb } from '@/lib/db';
import { authenticate, failure, json, readJson } from '@/lib/recipes/http';
import { createRecipeFor, listRecipes } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  return json(200, { recipes: listRecipes(getDb(), auth.user) });
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const result = createRecipeFor(getDb(), auth.user, parsed.body);
  return result.ok ? json(201, result.recipe) : failure(result);
}
