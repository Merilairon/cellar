import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { applyRestore, RestoreForbiddenError, type Strategy } from '@/lib/backup/restore';
import { beginApply, discardStage, getStage, pruneStaging } from '@/lib/backup/staging';
import { authenticate } from '@/lib/recipes/http';
import { fail, hardened, loadBackup, msg, readIdle } from '../../shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const STRATEGY_BODY_MAX = 1024;

/** The strategy, null when invalid, 'timeout' when the sender stalls past the idle limit. */
async function readStrategy(request: Request): Promise<Strategy | null | 'timeout'> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return null;
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > STRATEGY_BODY_MAX) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await readIdle(reader);
    if (next === 'timeout') {
      reader.cancel().catch(() => undefined);
      return 'timeout';
    }
    const { done, value } = next;
    if (done) break;
    total += value.byteLength;
    if (total > STRATEGY_BODY_MAX) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const s =
      typeof body === 'object' && body !== null ? (body as { strategy?: unknown }).strategy : null;
    return s === 'skip' || s === 'rename' ? s : null;
  } catch {
    return null;
  }
}

/**
 * Apply a staged backup. One apply per process (409). The staged file is removed afterwards,
 * whatever the outcome; a failure at recipe k keeps the earlier recipes and reports `failed_at`.
 */
export async function POST(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return hardened(auth);
  const { user } = auth;
  const env = getEnv();
  pruneStaging(env.RESTORE_DIR);
  const staged = getStage((await params).id, user.id);
  if (!staged) return fail(404, 'not_found', msg.notFound);
  const strategy = await readStrategy(request);
  if (strategy === 'timeout') return fail(408, 'request_timeout', msg.timeout);
  if (!strategy) return fail(400, 'invalid_strategy', msg.invalidStrategy);

  const lease = beginApply(staged);
  if (lease === 'busy') return fail(409, 'restore_in_progress', msg.inProgress);
  try {
    const loaded = await loadBackup(staged.path, staged.kind);
    if (!loaded.ok) return loaded.response;
    try {
      const result = await applyRestore(
        getDb(),
        { id: user.id, role: user.role },
        loaded.doc,
        loaded.archive,
        strategy,
        env.UPLOADS_DIR,
      );
      return hardened(Response.json(result, { status: 200 }));
    } finally {
      await loaded.archive?.close();
    }
  } catch (e) {
    if (e instanceof RestoreForbiddenError) return fail(403, 'forbidden', msg.forbidden);
    console.error('[restore] apply failed', (e as Error).message);
    return fail(500, 'restore_failed', msg.failed);
  } finally {
    lease.end();
    discardStage(staged);
  }
}
