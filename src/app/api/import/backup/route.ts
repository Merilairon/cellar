import { open } from 'node:fs/promises';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { previewRestore, RestoreForbiddenError } from '@/lib/backup/restore';
import {
  applyRunning,
  beginUpload,
  discardStage,
  ensureRestoreDir,
  newStagePath,
  pruneStaging,
  registerStage,
  removeFile,
  STAGE_TTL_MS,
  stageOf,
  type StageKind,
} from '@/lib/backup/staging';
import { MAX_MANIFEST_BYTES } from '@/lib/backup/unzip';
import { authenticate, noStore } from '@/lib/recipes/http';
import { fail, limits, loadBackup, msg } from './shared';

export const dynamic = 'force-dynamic';

type Streamed = 'ok' | 'too_large' | 'timeout';

/** Stream the request body to `path`, never holding more than one chunk and never past `max`. */
async function streamToFile(request: Request, path: string, max: number): Promise<Streamed> {
  const file = await open(path, 'wx', 0o600);
  const reader = request.body?.getReader();
  try {
    if (!reader) return 'ok';
    let total = 0;
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), limits.idleMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (next === 'timeout') {
        reader.cancel().catch(() => undefined);
        return 'timeout';
      }
      if (next.done) return 'ok';
      total += next.value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return 'too_large';
      }
      let at = 0;
      while (at < next.value.byteLength) {
        const { bytesWritten } = await file.write(next.value, at, next.value.byteLength - at);
        at += bytesWritten;
      }
    }
  } finally {
    await file.close().catch(() => undefined);
  }
}

/**
 * Stage a backup upload (G15): the body goes to disk with a hard cap, is validated completely
 * (zip structure, the manifest entry, schema, version) before any database read, and only then is a
 * preview computed. The staged file is removed on every failure. Order: CSRF 403, session 401,
 * media type 415, one upload per user and no apply of this user in flight (409), declared
 * length 413, streamed length 413 / stall 408, validation 422, scope 403.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const { user } = auth;

  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const kind: StageKind | null =
    type === 'application/json' ? 'json' : type === 'application/zip' ? 'zip' : null;
  if (!kind) return fail(415, 'unsupported_media_type', msg.unsupportedMedia);

  const env = getEnv();
  const dir = ensureRestoreDir(env.RESTORE_DIR);
  pruneStaging(dir);

  if (applyRunning(user.id)) return fail(409, 'restore_in_progress', msg.inProgress);
  const release = beginUpload(user.id);
  if (!release) return fail(409, 'restore_in_progress', msg.inProgress);

  // A JSON document is parsed in memory, so it gets the manifest cap; a zip gets the full cap.
  const max =
    kind === 'json' ? Math.min(env.RESTORE_BODY_MAX, MAX_MANIFEST_BYTES) : env.RESTORE_BODY_MAX;
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > max) {
    release();
    return fail(413, 'backup_too_large', msg.tooLarge);
  }

  const { id, path } = newStagePath(dir, kind);
  let keep = false;
  try {
    const streamed = await streamToFile(request, path, max);
    if (streamed === 'too_large') return fail(413, 'backup_too_large', msg.tooLarge);
    if (streamed === 'timeout') return fail(408, 'request_timeout', msg.timeout);

    const loaded = await loadBackup(path, kind);
    if (!loaded.ok) return loaded.response;
    try {
      const actor = { id: user.id, role: user.role };
      const preview = previewRestore(getDb(), actor, loaded.doc, loaded.archive);
      const old = stageOf(user.id);
      if (old && !old.applying) discardStage(old); // one staged file per user bounds disk use
      const createdAt = Date.now();
      registerStage({ id, ownerId: user.id, kind, path, createdAt });
      keep = true;
      return noStore(
        Response.json(
          {
            id,
            kind,
            expires_at: new Date(createdAt + STAGE_TTL_MS).toISOString(),
            preview,
          },
          { status: 201 },
        ),
      );
    } catch (e) {
      if (e instanceof RestoreForbiddenError) return fail(403, 'forbidden', msg.forbidden);
      throw e;
    } finally {
      await loaded.archive?.close();
    }
  } catch (e) {
    console.error('[restore] stage failed', (e as Error).message);
    return fail(500, 'restore_failed', msg.failed);
  } finally {
    release();
    if (!keep) removeFile(path);
  }
}
