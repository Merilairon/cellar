import { stat } from 'node:fs/promises';
import { z } from 'zod';
import {
  buildBackup,
  BackupExportError,
  BackupForbiddenError,
  listBackupFiles,
} from '@/lib/backup/export';
import { omitMissingPhotos } from '@/lib/backup/prune';
import { exportCaps } from '@/lib/backup/unzip';
import { BACKUP_ENTRY, createZipStream, ZipTooLargeError, type ZipEntry } from '@/lib/backup/zip';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { resolveUploadPath } from '@/lib/import/uploads';
import { log } from '@/lib/log';
import { authenticate, noStore } from '@/lib/recipes/http';
import { acquireExport, exportLimiter } from '@/lib/security/export-limits';
import messages from '../../../../messages/en.json';

export const dynamic = 'force-dynamic';

const msg = messages.backup.export.error;

// `all` and `photos` take only the value 1. Unknown or repeated parameters are 400, so a
// client never believes it asked for something it did not get.
const querySchema = z.strictObject({
  all: z.literal('1').optional(),
  photos: z.literal('1').optional(),
});

// Error bodies carry a human `message`: the download is an <a download>, so a failure shows
// as a raw JSON page (UX spec F5). The `error` codes are the stable contract.
const fail = (status: number, error: string, message: string, headers?: Record<string, string>) =>
  noStore(Response.json({ error, message }, { status, headers }));

export async function GET(request: Request) {
  // GET passes `isCsrfSafe`, but a cross-site navigation carries the Lax cookie and would spend
  // one of the user's hourly exports on a forced download (v1.0 review L3). Absent, same-origin,
  // same-site and none (typed URL, bookmark) stay allowed, so curl and scripts work.
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return noStore(new Response(null, { status: 403 }));
  }
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const { user } = auth;

  const params = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    if (values.length > 1) return fail(400, 'invalid_query', msg.invalidQuery);
    raw[key] = values[0]!;
  }
  const query = querySchema.safeParse(raw);
  if (!query.success) return fail(400, 'invalid_query', msg.invalidQuery);
  const all = query.data.all === '1';
  const photos = query.data.photos === '1';
  if (all && user.role !== 'admin') return fail(403, 'forbidden', msg.forbidden);

  // One in flight per user (409, does not use quota), then the per-user window (429).
  const release = acquireExport(user.id);
  if (!release) return fail(409, 'export_in_progress', msg.inProgress);
  let streaming = false;
  try {
    const limited = exportLimiter().hit(user.id);
    if (!limited.allowed) {
      return fail(429, 'rate_limited', msg.rateLimited, {
        'Retry-After': String(limited.retryAfterSec),
      });
    }

    // `scope: 'all'` is the admin-all audit event (T10 review). Never the file names or content.
    log('info', 'export.started', {
      user_id: user.id,
      scope: all ? 'all' : 'own',
      photos,
    });
    const now = new Date();
    const doc = buildBackup(getDb(), { id: user.id, role: user.role }, { all, now });
    const stamp = now.toISOString().slice(0, 10);
    const headers = (type: string, ext: string) => ({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="cellar-backup-${stamp}.${ext}"`,
      'Cache-Control': 'private, no-store',
    });

    // An export that restore would refuse is never produced: the manifest has the same cap on
    // both sides (413 `export_too_large`, no quota used).
    const tooBig = () => {
      log('warn', 'export.rejected', { user_id: user.id, reason: 'too_large' });
      exportLimiter().refund(user.id);
      return fail(413, 'export_too_large', msg.manifestTooLarge);
    };

    if (!photos) {
      const text = JSON.stringify(doc);
      if (Buffer.byteLength(text) > exportCaps.manifestBytes) return tooBig();
      log('info', 'export.finished', {
        user_id: user.id,
        scope: all ? 'all' : 'own',
        photos,
        recipes: doc.recipes.length,
        bytes: Buffer.byteLength(text),
      });
      return new Response(text, { headers: headers('application/json', 'json') });
    }

    // The manifest is built after a stat of every file, so it never names a missing one.
    const uploads = getEnv().UPLOADS_DIR;
    const found = new Map<string, { path: string; size: number }>();
    for (const rel of listBackupFiles(doc)) {
      const abs = resolveUploadPath(uploads, rel.slice('photos/'.length));
      const st = abs ? await stat(abs).catch(() => null) : null;
      if (abs && st?.isFile()) found.set(rel, { path: abs, size: st.size });
    }
    const pruned = omitMissingPhotos(doc, new Set(found.keys()));
    const manifest = Buffer.from(JSON.stringify(pruned));
    if (manifest.length > exportCaps.manifestBytes) return tooBig();
    const entries: ZipEntry[] = [
      { name: BACKUP_ENTRY, data: manifest },
      ...listBackupFiles(pruned).map((rel) => ({ name: rel, ...found.get(rel)! })),
    ];
    const body = createZipStream(entries, {
      now,
      onClose: ({ bytes, completed }) => {
        release();
        log(completed ? 'info' : 'warn', completed ? 'export.finished' : 'export.aborted', {
          user_id: user.id,
          scope: all ? 'all' : 'own',
          photos,
          recipes: pruned.recipes.length,
          bytes,
        });
      },
    });
    const response = new Response(body, { headers: headers('application/zip', 'zip') });
    streaming = true;
    return response;
  } catch (e) {
    exportLimiter().refund(user.id); // a failed export does not use up the quota
    if (e instanceof ZipTooLargeError) {
      log('warn', 'export.rejected', { user_id: user.id, reason: 'too_large' });
      return fail(413, 'export_too_large', msg.tooLarge);
    }
    if (e instanceof BackupForbiddenError) return fail(403, 'forbidden', msg.forbidden);
    log('error', 'export.failed', {
      user_id: user.id,
      reason: e instanceof BackupExportError ? 'unexportable_data' : 'error',
      err: e,
    });
    return fail(500, 'export_failed', msg.failed);
  } finally {
    if (!streaming) release();
  }
}
