import { getDb } from '@/lib/db';
import { authenticate, failure, json, noStore, readJson } from '@/lib/recipes/http';
import { setVisibilityFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const parsed = await readJson(request);
  if (parsed instanceof Response) return noStore(parsed);
  const result = setVisibilityFor(getDb(), auth.user, (await params).id, parsed.body);
  return noStore(result.ok ? json(200, { visibility: result.visibility }) : failure(result));
}
