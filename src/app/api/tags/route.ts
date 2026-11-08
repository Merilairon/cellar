import { getDb } from '@/lib/db';
import { authenticate, json, noStore } from '@/lib/recipes/http';
import { listTagsFor } from '@/lib/recipes/service';
import { MAX_TAG_LEN } from '@/lib/recipes/tag-name';

export const dynamic = 'force-dynamic';

/** Tags on recipes the caller can read, with counts. `q` is a prefix (max 40 characters). */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const q = new URL(request.url).searchParams.get('q');
  if (q !== null && [...q].length > MAX_TAG_LEN)
    return noStore(json(400, { error: 'invalid_query' }));
  const res = json(200, { tags: listTagsFor(getDb(), auth.user, q) });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
