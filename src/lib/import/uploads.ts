import { rmSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** Resolve a stored relative file path inside the uploads dir; null if it would escape it. */
export function resolveUploadPath(uploadsDir: string, filePath: string): string | null {
  if (!filePath || isAbsolute(filePath)) return null;
  const base = resolve(uploadsDir);
  const abs = resolve(base, filePath);
  const rel = relative(base, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return abs;
}

/** Best-effort removal of stored files; failures are logged, never thrown. */
export function removeUploadFiles(uploadsDir: string, filePaths: string[]): void {
  for (const p of filePaths) {
    const abs = resolveUploadPath(uploadsDir, p);
    if (!abs) {
      console.warn('[uploads] refusing to remove path outside uploads dir');
      continue;
    }
    try {
      rmSync(abs, { force: true });
    } catch (e) {
      console.warn('[uploads] could not remove file', (e as Error).message);
    }
  }
}
