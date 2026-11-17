import { readFile, stat } from 'node:fs/promises';
import { migrateBackup } from '@/lib/backup/migrate';
import { parseBackupJson } from '@/lib/backup/parse';
import type { BackupV1 } from '@/lib/backup/schema';
import { openZip, ZipFormatError, MAX_MANIFEST_BYTES, type OpenedZip } from '@/lib/backup/unzip';
import type { StageKind } from '@/lib/backup/staging';
import { BACKUP_ENTRY } from '@/lib/backup/zip';
import { noStore } from '@/lib/recipes/http';
import messages from '../../../../../messages/en.json';

/** A sender that sends nothing for `idleMs` is cut off with 408 (slow-loris guard). Test seam. */
export const limits = { idleMs: 30_000 };

export const msg = messages.backup.restore.error;

/**
 * Headers for every response of the restore routes. The proxy does not run on them (matcher
 * exclusion), so `nosniff` and `no-store` are set here: success, 401 and 403 included.
 */
export const hardened = (res: Response): Response => {
  noStore(res);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
};

/** `reader.read()` that gives up with 'timeout' after `limits.idleMs` without data. */
export async function readIdle<T>(
  reader: ReadableStreamDefaultReader<T>,
): Promise<ReadableStreamReadResult<T> | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    reader.read(),
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), limits.idleMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Error body `{ error, message }` (plus extras), never cached. */
export const fail = (
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response => {
  return hardened(Response.json({ error, message, ...extra }, { status }));
};

export type Loaded =
  { ok: true; doc: BackupV1; archive: OpenedZip | null } | { ok: false; response: Response };

/**
 * Read, parse and migrate a staged file. Nothing here touches the database. The archive (zip)
 * is returned open; the caller closes it.
 */
export async function loadBackup(path: string, kind: StageKind): Promise<Loaded> {
  let archive: OpenedZip | null = null;
  try {
    let bytes: Buffer;
    if (kind === 'zip') {
      archive = await openZip(path);
      if (!archive.has(BACKUP_ENTRY)) throw new ZipFormatError('manifest_missing');
      bytes = await archive.read(BACKUP_ENTRY);
    } else {
      if ((await stat(path)).size > MAX_MANIFEST_BYTES) {
        return { ok: false, response: fail(413, 'backup_too_large', msg.tooLarge) };
      }
      bytes = await readFile(path);
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return invalid(['not_utf8'], archive);
    }
    const parsed = parseBackupJson(text);
    if (!parsed.ok) return invalid([parsed.reason], archive);
    const migrated = migrateBackup(parsed.value);
    if (!migrated.ok) {
      if (migrated.code === 'backup_version_unsupported') {
        const found = migrated.version;
        await archive?.close();
        return {
          ok: false,
          response: fail(
            422,
            'backup_version_unsupported',
            typeof found === 'number' && found > 1 ? msg.versionNewer : msg.versionUnsupported,
            { found },
          ),
        };
      }
      return invalid(
        (migrated.errors ?? []).map((e) => (e.path ? `${e.path}: ${e.code}` : e.code)),
        archive,
      );
    }
    return { ok: true, doc: migrated.doc, archive };
  } catch (e) {
    await archive?.close();
    if (e instanceof ZipFormatError) {
      if (e.reason === 'entry_name_not_allowed' && e.entry !== undefined) {
        // Say WHICH entry (already control-stripped and truncated) so the user can fix the zip.
        return {
          ok: false,
          response: fail(
            422,
            'backup_zip_invalid',
            msg.zipEntryRefused.replace('{name}', `"${e.entry}"`),
            { errors: [`entry_name_not_allowed: ${e.entry}`] },
          ),
        };
      }
      return { ok: false, response: fail(422, 'backup_zip_invalid', msg.zipInvalid) };
    }
    throw e;
  }
}

function invalid(errors: string[], archive: OpenedZip | null): Loaded {
  void archive?.close();
  return {
    ok: false,
    response: fail(422, 'backup_invalid', msg.invalid, { errors: errors.slice(0, 10) }),
  };
}
