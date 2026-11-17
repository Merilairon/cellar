import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { ulid } from 'ulid';
import { errCode, log } from '@/lib/log';

// Staged restore uploads (T11, G15). A staged file lives in RESTORE_DIR until it is applied,
// discarded, or one hour old. Single process by design: the registry is in memory (like the
// rate limiters) and is kept on globalThis because Next may bundle the stage route and the
// apply route as separate modules that must see one registry. No background timers: expiry is
// enforced lazily by `pruneStaging`, which every restore call runs first. After a restart the
// registry is empty, so leftover files are orphans and the next prune removes them once they
// are older than the TTL.

export const STAGE_TTL_MS = 60 * 60 * 1000;
export const STAGE_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const STAGED_FILE_RE = /^[0-9A-HJKMNP-TV-Z]{26}\.(json|zip)$/;

export type StageKind = 'json' | 'zip';
export type Staged = {
  id: string;
  ownerId: string;
  kind: StageKind;
  path: string;
  createdAt: number;
  applying: boolean;
};

type Registry = {
  stages: Map<string, Staged>;
  /** Users with an upload being streamed right now (one per user). */
  uploading: Set<string>;
  /** Id of the stage being applied in this process, if any. */
  applyingId: string | null;
};
const g = globalThis as unknown as { __restoreStaging?: Registry };
const reg = (): Registry =>
  (g.__restoreStaging ??= { stages: new Map(), uploading: new Set(), applyingId: null });

/** Create the restore directory (0700) and return it. */
export function ensureRestoreDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function newStagePath(dir: string, kind: StageKind): { id: string; path: string } {
  const id = ulid();
  // Plain concatenation: `join` with a runtime directory makes Turbopack trace the whole project.
  return { id, path: `${dir}${sep}${id}.${kind}` };
}

export function removeFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch (e) {
    log('warn', 'restore.stage_remove_failed', { code: errCode(e) });
  }
}

/**
 * Drop expired stages (never one being applied) and delete orphan files in `dir` that are older
 * than the TTL and not registered. A file still being uploaded is registered nowhere but is
 * fresh (its mtime moves with every write), so it survives.
 */
export function pruneStaging(dir: string, now: number = Date.now()): void {
  const r = reg();
  for (const s of [...r.stages.values()]) {
    if (!s.applying && now - s.createdAt >= STAGE_TTL_MS) {
      r.stages.delete(s.id);
      removeFile(s.path);
    }
  }
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const known = new Set([...r.stages.values()].map((s) => s.path));
  for (const name of names) {
    if (!STAGED_FILE_RE.test(name)) continue;
    const path = join(dir, name);
    if (known.has(path)) continue;
    try {
      if (now - statSync(path).mtimeMs >= STAGE_TTL_MS) removeFile(path);
    } catch {
      // vanished between readdir and stat
    }
  }
}

export function registerStage(s: Omit<Staged, 'applying'>): Staged {
  const staged: Staged = { ...s, applying: false };
  reg().stages.set(s.id, staged);
  return staged;
}

/** The caller's live stage, or undefined (unknown, expired, or someone else's: all the same). */
export function getStage(
  id: string,
  ownerId: string,
  now: number = Date.now(),
): Staged | undefined {
  if (!STAGE_ID_RE.test(id)) return undefined;
  const s = reg().stages.get(id);
  if (!s || s.ownerId !== ownerId) return undefined;
  if (!s.applying && now - s.createdAt >= STAGE_TTL_MS) return undefined;
  return s;
}

/** The user's current stage (at most one is kept), regardless of age. */
export function stageOf(ownerId: string): Staged | undefined {
  return [...reg().stages.values()].find((s) => s.ownerId === ownerId);
}

/** Forget a stage and delete its file. */
export function discardStage(s: Staged): void {
  reg().stages.delete(s.id);
  removeFile(s.path);
}

export function listStages(): Staged[] {
  return [...reg().stages.values()];
}

/** Take the one-per-user upload slot. Returns a release function, or null when taken. */
export function beginUpload(ownerId: string): (() => void) | null {
  const u = reg().uploading;
  if (u.has(ownerId)) return null;
  u.add(ownerId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    u.delete(ownerId);
  };
}

/**
 * Mark a stage as being applied. One apply per process: 'busy' when any apply runs. The
 * returned `end` clears the mark and is idempotent.
 */
export function beginApply(s: Staged): { end: () => void } | 'busy' {
  const r = reg();
  if (r.applyingId !== null) return 'busy';
  r.applyingId = s.id;
  s.applying = true;
  let ended = false;
  return {
    end() {
      if (ended) return;
      ended = true;
      s.applying = false;
      if (r.applyingId === s.id) r.applyingId = null;
    },
  };
}

/** True when a stage of this user is being applied right now, or an apply runs anywhere. */
export function applyRunning(ownerId?: string): boolean {
  const r = reg();
  if (ownerId === undefined) return r.applyingId !== null;
  return [...r.stages.values()].some((s) => s.ownerId === ownerId && s.applying);
}

/** Test seam: forget everything (does not delete files). */
export function resetStagingForTests(): void {
  const r = reg();
  r.stages.clear();
  r.uploading.clear();
  r.applyingId = null;
}
