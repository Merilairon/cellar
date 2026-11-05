import { getDb } from '@/lib/db';
import { getImportFor } from '@/lib/import/service';
import { authenticate, json } from '@/lib/recipes/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Restore a review after reload. Owner only; anyone else gets 404. */
export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const job = getImportFor(getDb(), auth.user, (await params).id);
  return job ? json(200, job) : new Response(null, { status: 404 });
}
