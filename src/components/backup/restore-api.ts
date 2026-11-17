import { call } from '../recipe/api';
import {
  applyError,
  backupContentType,
  parseApplyResult,
  parseStage,
  stageError,
  type ApplyFailure,
  type ApplyResult,
  type RestoreError,
  type Stage,
  type Strategy,
} from './backup-logic';

export type StageResult =
  | { ok: true; stage: Stage }
  | { ok: false; aborted: true }
  | { ok: false; aborted?: false; error: RestoreError };

/**
 * POST the raw file to /api/import/backup. XMLHttpRequest because fetch cannot report upload
 * progress. Never throws; `abort()` resolves the promise with `aborted`.
 */
export function stageBackup(
  file: File,
  max: number,
  onProgress: (percent: number) => void,
): { promise: Promise<StageResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<StageResult>((resolve) => {
    const type = backupContentType(file.name);
    if (type === null) return resolve({ ok: false, error: { key: 'extension' } });
    xhr.open('POST', '/api/import/backup');
    xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onabort = () => resolve({ ok: false, aborted: true });
    xhr.onerror = () => resolve({ ok: false, error: stageError(0, null, max) });
    xhr.ontimeout = xhr.onerror;
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      const stage = xhr.status === 201 ? parseStage(body) : null;
      resolve(
        stage ? { ok: true, stage } : { ok: false, error: stageError(xhr.status, body, max) },
      );
    };
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export type ApplyOutcome = { ok: true; result: ApplyResult } | { ok: false; failure: ApplyFailure };

export async function applyBackup(id: string, strategy: Strategy): Promise<ApplyOutcome> {
  const res = await call(`/api/import/backup/${encodeURIComponent(id)}/apply`, 'POST', {
    strategy,
  });
  if (!res) return { ok: false, failure: applyError(0, null) };
  const body = await json(res);
  const result = res.ok ? parseApplyResult(body) : null;
  return result ? { ok: true, result } : { ok: false, failure: applyError(res.status, body) };
}

/** Discard a staged file; the outcome does not matter to the user (it expires anyway). */
export async function discardBackup(id: string): Promise<void> {
  await call(`/api/import/backup/${encodeURIComponent(id)}`, 'DELETE');
}
