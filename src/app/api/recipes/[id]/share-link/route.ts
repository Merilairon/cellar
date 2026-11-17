import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { log } from '@/lib/log';
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
  const id = (await params).id;
  const db = getDb();
  const result = createOrRotateLinkFor(db, auth.user, id, { baseUrl: env.BASE_URL });
  // Recipe id and actor only: never the token or the URL (it contains the token).
  if (result.ok) {
    log('info', result.rotated ? 'share_link.rotated' : 'share_link.created', {
      recipe_id: id,
      actor_id: auth.user.id,
    });
  }
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
  // Revoke is always safe, also while links are disabled: the token is cleared, so turning the
  // feature back on cannot revive a link the owner revoked.
  const id = (await params).id;
  const result = revokeLinkFor(getDb(), auth.user, id);
  if (result.ok) log('info', 'share_link.revoked', { recipe_id: id, actor_id: auth.user.id });
  return noStore(result.ok ? new Response(null, { status: 204 }) : failure(result));
}
