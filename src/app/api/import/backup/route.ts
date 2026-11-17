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
import { errCode, log } from '@/lib/log';
import { authenticate } from '@/lib/recipes/http';
import { restoreLimiter } from '@/lib/security/export-limits';
import { fail, hardened, loadBackup, msg, readIdle } from './shared';

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
      const next = await readIdle(reader);
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
  if (auth instanceof Response) return hardened(auth);
  const { user } = auth;

  // Quota is taken once the caller is known and given back for every rejection that happens
  // before a byte is staged (media type, 409, declared length). A 429 leaves the slot free.
  const limiter = restoreLimiter();
  const limited = limiter.hit(user.id);
  if (!limited.allowed) {
    const res = fail(429, 'rate_limited', msg.rateLimited);
    res.headers.set('Retry-After', String(limited.retryAfterSec));
    return res;
  }
  const refund = () => limiter.refund(user.id);

  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const kind: StageKind | null =
    type === 'application/json' ? 'json' : type === 'application/zip' ? 'zip' : null;
  if (!kind) {
    refund();
    return fail(415, 'unsupported_media_type', msg.unsupportedMedia);
  }

  const env = getEnv();
  const dir = ensureRestoreDir(env.RESTORE_DIR);
  pruneStaging(dir);

  if (applyRunning(user.id)) {
    refund();
    return fail(409, 'restore_in_progress', msg.inProgress);
  }
  const release = beginUpload(user.id);
  if (!release) {
    refund();
    return fail(409, 'restore_in_progress', msg.inProgress);
  }

  // A JSON document is parsed in memory, so it gets the manifest cap; a zip gets the full cap.
  const max =
    kind === 'json' ? Math.min(env.RESTORE_BODY_MAX, MAX_MANIFEST_BYTES) : env.RESTORE_BODY_MAX;
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > max) {
    release();
    refund();
    return fail(413, 'backup_too_large', msg.tooLarge);
  }

  const { id, path } = newStagePath(dir, kind);
  let keep = false;
  try {
    const streamed = await streamToFile(request, path, max);
    if (streamed !== 'ok') {
      log('warn', 'restore.failed', { user_id: user.id, phase: 'stage', code: streamed });
    }
    if (streamed === 'too_large') return fail(413, 'backup_too_large', msg.tooLarge);
    if (streamed === 'timeout') return fail(408, 'request_timeout', msg.timeout);

    const loaded = await loadBackup(path, kind);
    if (!loaded.ok) {
      log('warn', 'restore.failed', {
        user_id: user.id,
        phase: 'stage',
        status: loaded.response.status,
      });
      return loaded.response;
    }
    try {
      const actor = { id: user.id, role: user.role };
      const preview = previewRestore(getDb(), actor, loaded.doc, loaded.archive);
      const old = stageOf(user.id);
      if (old && !old.applying) discardStage(old); // one staged file per user bounds disk use
      const createdAt = Date.now();
      registerStage({ id, ownerId: user.id, kind, path, createdAt });
      keep = true;
      log('info', 'restore.staged', {
        user_id: user.id,
        kind,
        scope: preview.scope,
        recipes: preview.recipes,
        photos: preview.photos,
        conflicts: preview.conflicts.length,
      });
      return hardened(
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
    log('error', 'restore.failed', { user_id: user.id, phase: 'stage', code: errCode(e) });
    return fail(500, 'restore_failed', msg.failed);
  } finally {
    release();
    if (!keep) removeFile(path);
  }
}
