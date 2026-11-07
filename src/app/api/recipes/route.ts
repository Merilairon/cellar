import { z } from 'zod';
import { getDb } from '@/lib/db';
import { authenticate, failure, json, readJson } from '@/lib/recipes/http';
import { createRecipeFor, listRecipes } from '@/lib/recipes/service';
import { MAX_TAG_LEN } from '@/lib/recipes/tag-name';

export const dynamic = 'force-dynamic';

// Only q, tag and author are accepted. Anything else (min_rating arrives with ratings in 04c)
// or a repeated parameter is 400 invalid_query, so a client never believes it is filtering.
const querySchema = z.strictObject({
  q: z.string().max(100).optional(),
  tag: z.string().min(1).max(MAX_TAG_LEN).optional(),
  author: z
    .string()
    .regex(/^(me|[0-9A-HJKMNP-TV-Z]{26})$/i)
    .optional(),
});

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    if (all.length > 1) return json(400, { error: 'invalid_query' });
    raw[key] = all[0]!;
  }
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: 'invalid_query' });
  const res = json(200, { recipes: listRecipes(getDb(), auth.user, parsed.data) });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const result = createRecipeFor(getDb(), auth.user, parsed.body);
  return result.ok ? json(201, result.recipe) : failure(result);
}
