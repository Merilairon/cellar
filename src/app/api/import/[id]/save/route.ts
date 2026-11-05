import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { saveImport } from '@/lib/import/save';
import { serverFetchOptions } from '@/lib/import/route-deps';
import { authenticate, failure, json, readJson, SAVE_BODY_MAX } from '@/lib/recipes/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, SAVE_BODY_MAX);
  if (parsed instanceof Response) return parsed;
  const result = await saveImport(getDb(), auth.user, (await params).id, parsed.body, {
    fetchOptions: serverFetchOptions(),
    uploadsDir: getEnv().UPLOADS_DIR,
  });
  if (!result.ok) {
    return result.status === 409 ? json(409, { error: 'already_saved' }) : failure(result);
  }
  return json(201, { id: result.id, warnings: result.warnings });
}
