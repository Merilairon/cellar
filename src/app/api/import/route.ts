import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { createImport } from '@/lib/import/service';
import { importLog, serverFetchOptions } from '@/lib/import/route-deps';
import { importRequestSchema } from '@/lib/import/schemas';
import { authenticate, json, readJson } from '@/lib/recipes/http';
import { importLimiter } from '@/lib/security/import-limits';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticate(request); // CSRF (403) before anything else, then 401
  if (auth instanceof Response) return auth;

  // Per user, counts every attempt (failures included), before any parsing or network work.
  const limited = importLimiter().hit(auth.user.id);
  if (!limited.allowed) {
    return Response.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(limited.retryAfterSec), 'Cache-Control': 'no-store' },
      },
    );
  }

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const input = importRequestSchema.safeParse(parsed.body);
  if (!input.success) return json(422, { error: 'invalid_request' });

  const env = getEnv();
  const result = await createImport(
    getDb(),
    auth.user,
    input.data.url !== undefined ? { url: input.data.url } : { text: input.data.text! },
    {
      fetchOptions: serverFetchOptions(),
      keepRawHtml: env.KEEP_RAW_HTML,
      uploadsDir: env.UPLOADS_DIR,
      log: importLog,
    },
  );
  return json(200, result);
}
