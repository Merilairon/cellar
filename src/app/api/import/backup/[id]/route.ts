import { getEnv } from '@/lib/env';
import { discardStage, getStage, pruneStaging } from '@/lib/backup/staging';
import { authenticate } from '@/lib/recipes/http';
import { fail, hardened, msg } from '../shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Discard a staged upload and its file. 404 for an unknown, expired or foreign id. */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return hardened(auth);
  pruneStaging(getEnv().RESTORE_DIR);
  const staged = getStage((await params).id, auth.user.id);
  if (!staged) return fail(404, 'not_found', msg.notFound);
  if (staged.applying) return fail(409, 'restore_in_progress', msg.inProgress);
  discardStage(staged);
  return hardened(new Response(null, { status: 204 }));
}
