import { getEnv } from '@/lib/env';
import { getDb } from '@/lib/db';
import { authenticate, failure, json, readJson } from '@/lib/recipes/http';
import { deleteRecipeFor, getRecipeFor, updateRecipeFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const result = getRecipeFor(getDb(), auth.user, (await params).id);
  return result.ok ? json(200, result.recipe) : failure(result);
}

export async function PUT(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const result = updateRecipeFor(getDb(), auth.user, (await params).id, parsed.body);
  return result.ok ? json(200, result.recipe) : failure(result);
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const result = deleteRecipeFor(getDb(), auth.user, (await params).id, {
    uploadsDir: getEnv().UPLOADS_DIR,
  });
  return result.ok ? new Response(null, { status: 204 }) : failure(result);
}
