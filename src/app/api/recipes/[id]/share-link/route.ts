import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { authenticate, failure, json, noStore } from '@/lib/recipes/http';
import { createOrRotateLinkFor, revokeLinkFor } from '@/lib/recipes/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const disabled = () => json(403, { error: 'public_links_disabled' });

/** Create the public link, or rotate it when one exists. */
export async function POST(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const env = getEnv();
  if (!env.PUBLIC_LINKS_ENABLED) return noStore(disabled());
  const result = createOrRotateLinkFor(getDb(), auth.user, (await params).id, {
    baseUrl: env.BASE_URL,
  });
  return noStore(
    result.ok
      ? json(201, { share: { enabled: true, token: result.token, url: result.url } })
      : failure(result),
  );
}

/** Revoke the public link (204, also when none exists). */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  if (!getEnv().PUBLIC_LINKS_ENABLED) return noStore(disabled());
  const result = revokeLinkFor(getDb(), auth.user, (await params).id);
  return noStore(result.ok ? new Response(null, { status: 204 }) : failure(result));
}
