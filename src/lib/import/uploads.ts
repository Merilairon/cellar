import { lstatSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { log } from '@/lib/log';

const isInside = (base: string, target: string, allowSame = false): boolean => {
  const rel = relative(base, target);
  return (allowSame || rel !== '') && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * True when the real location of `abs` (symlinks resolved) is still inside the real uploads
 * dir. Works for a file that does not exist yet: the deepest existing ancestor is resolved
 * instead. A symlink that cannot be resolved (dangling) is refused: a write through it would
 * create the file at its target.
 */
function realPathInside(base: string, abs: string): boolean {
  let realBase: string;
  try {
    realBase = realpathSync(base);
  } catch {
    return true; // no uploads dir yet: nothing on disk to follow
  }
  for (let cur = abs; ; cur = dirname(cur)) {
    try {
      lstatSync(cur);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code === 'ENOENT' || code === 'ENOTDIR') && dirname(cur) !== cur) continue;
      return false;
    }
    try {
      return isInside(realBase, realpathSync(cur), true);
    } catch {
      return false;
    }
  }
}

/**
 * Resolve a stored relative file path inside the uploads dir; null if it would escape it,
 * lexically (`..`, absolute) or through a symlink (v1.0 T14: the check used to be lexical only).
 */
export function resolveUploadPath(uploadsDir: string, filePath: string): string | null {
  if (!filePath || filePath.includes('\0') || isAbsolute(filePath)) return null;
  const base = resolve(uploadsDir);
  const abs = resolve(base, filePath);
  if (!isInside(base, abs)) return null;
  return realPathInside(base, abs) ? abs : null;
}

/** Best-effort removal of stored files; failures are logged, never thrown. */
export function removeUploadFiles(uploadsDir: string, filePaths: string[]): void {
  for (const p of filePaths) {
    const abs = resolveUploadPath(uploadsDir, p);
    if (!abs) {
      log('warn', 'uploads.remove_refused', { reason: 'outside_uploads_dir' });
      continue;
    }
    try {
      rmSync(abs, { force: true });
    } catch (e) {
      log('warn', 'uploads.remove_failed', { err: e });
    }
  }
}
