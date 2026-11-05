import { getDb } from '@/lib/db';
import { authenticate, failure, json } from '@/lib/recipes/http';
import { copyRecipeFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const result = copyRecipeFor(getDb(), auth.user, (await params).id);
  return result.ok ? json(201, { id: result.id }) : failure(result);
}
