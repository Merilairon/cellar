import { getDb } from '@/lib/db';
import { authenticate, failure, json, noStore, readJson } from '@/lib/recipes/http';
import { RATING_BODY_MAX, clearRatingFor, setRatingFor } from '@/lib/recipes/ratings';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const parsed = await readJson(request, RATING_BODY_MAX);
  if (parsed instanceof Response) return noStore(parsed);
  const result = setRatingFor(getDb(), auth.user, (await params).id, parsed.body);
  return noStore(result.ok ? json(200, result.rating) : failure(result));
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const result = clearRatingFor(getDb(), auth.user, (await params).id);
  return noStore(result.ok ? new Response(null, { status: 204 }) : failure(result));
}
