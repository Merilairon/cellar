import { getDb } from '@/lib/db';
import { authenticate, failure, json, noStore, readJson } from '@/lib/recipes/http';
import { updateGridFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Atomic grid-editor save. Every response, success or failure, is `private, no-store`. */
export async function PUT(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const parsed = await readJson(request);
  if (parsed instanceof Response) return noStore(parsed);
  const result = updateGridFor(getDb(), auth.user, (await params).id, parsed.body);
  return noStore(result.ok ? json(200, result.recipe) : failure(result));
}

const notAllowed = () => noStore(new Response(null, { status: 405, headers: { Allow: 'PUT' } }));
export const GET = notAllowed;
export const POST = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
