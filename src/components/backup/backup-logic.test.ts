import { describe, expect, it } from 'vitest';
import {
  applyCount,
  applyError,
  backupContentType,
  exportHref,
  formatBytes,
  initialRestoreState,
  parseApplyResult,
  parseStage,
  precheckBackup,
  resultLines,
  restoreReducer,
  splitConflicts,
  stageError,
  type ApplyResult,
  type Preview,
  type RestoreState,
  type Stage,
} from './backup-logic';

const preview = (o: Partial<Preview> = {}): Preview => ({
  scope: 'own',
  recipes: 12,
  sections: 15,
  ingredients: 80,
  notes: 31,
  ratings: 9,
  photos: 20,
  conflicts: [],
  unknown_users: [],
  notes_skipped: 0,
  ratings_skipped: 0,
  ...o,
});
const stage = (o: Partial<Preview> = {}): Stage => ({
  id: 'S1',
  kind: 'zip',
  expires_at: '2026-11-17T10:00:00Z',
  preview: preview(o),
});
const result = (o: Partial<ApplyResult> = {}): ApplyResult => ({
  imported: 9,
  skipped: 3,
  renamed: 0,
  notes_restored: 0,
  notes_skipped: 0,
  ratings_restored: 0,
  ratings_skipped: 0,
  photos_restored: 20,
  photos_failed: 0,
  failed_at: null,
  ...o,
});

describe('export and file helpers', () => {
  it('builds the export href from the checkboxes', () => {
    expect(exportHref({ photos: false, all: false })).toBe('/api/export');
    expect(exportHref({ photos: true, all: false })).toBe('/api/export?photos=1');
    expect(exportHref({ photos: true, all: true })).toBe('/api/export?all=1&photos=1');
  });
  it('picks the content type by extension', () => {
    expect(backupContentType('A.JSON')).toBe('application/json');
    expect(backupContentType('cellar.zip')).toBe('application/zip');
    expect(backupContentType('cellar.json.exe')).toBeNull();
    expect(backupContentType('cellar')).toBeNull();
  });
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(48 * 1024 * 1024)).toBe('48 MB');
    expect(formatBytes(256 * 1024 * 1024)).toBe('256 MB');
  });
  it('prechecks extension then size', () => {
    expect(precheckBackup({ name: 'a.txt', size: 1 }, 100)).toEqual({ key: 'extension' });
    expect(precheckBackup({ name: 'a.zip', size: 2048 }, 1024)).toEqual({
      key: 'tooLarge',
      params: { max: '1 KB' },
    });
    expect(precheckBackup({ name: 'a.zip', size: 10 }, 1024)).toBeNull();
  });
});

describe('error mapping', () => {
  it('maps network and server failures', () => {
    expect(stageError(0, null, 10).key).toBe('network');
    expect(stageError(500, { message: 'x' }, 10).key).toBe('network');
  });
  it('carries the server message and the found version', () => {
    const e = stageError(
      422,
      { error: 'backup_version_unsupported', message: 'Too new.', found: 2 },
      10,
    );
    expect(e).toMatchObject({ key: 'backup_version_unsupported', message: 'Too new.' });
    expect(e.params).toEqual({ version: '2' });
  });
  it('does not repeat a version the message already shows', () => {
    const e = stageError(
      422,
      { error: 'backup_version_unsupported', message: 'Backup version 2 is newer', found: 2 },
      10,
    );
    expect(e.params).toBeUndefined();
  });
  it('maps codes and keeps at most five detail strings, text only', () => {
    const errors = ['a', 'b', 'c', 'd', 'e', 'f', 7];
    const e = stageError(422, { error: 'backup_invalid', errors }, 10);
    expect(e.key).toBe('backup_invalid');
    expect(e.details).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(stageError(422, { error: 'backup_zip_invalid' }, 10).key).toBe('zip_invalid');
    expect(stageError(422, {}, 10).key).toBe('backup_invalid');
  });
  it('maps statuses', () => {
    expect(stageError(413, null, 1024)).toMatchObject({ key: 'tooLarge', params: { max: '1 KB' } });
    expect(stageError(415, null, 1).key).toBe('extension');
    expect(stageError(403, { message: 'Only admin' }, 1)).toMatchObject({
      key: 'scope_forbidden',
      message: 'Only admin',
    });
    expect(stageError(409, null, 1).key).toBe('in_progress');
    expect(stageError(401, null, 1).key).toBe('unauthenticated');
  });
  it('ignores a non-string or blank message', () => {
    expect(stageError(409, { message: '  ' }, 1).message).toBeUndefined();
    expect(stageError(409, { message: 5 }, 1).message).toBeUndefined();
  });
  it('maps apply failures; only 404 expires the stage', () => {
    expect(applyError(404, null)).toMatchObject({ expired: true, error: { key: 'expired' } });
    expect(applyError(409, null)).toMatchObject({ expired: false, error: { key: 'in_progress' } });
    expect(applyError(0, null)).toMatchObject({ expired: false, error: { key: 'network' } });
    expect(applyError(403, null).error.key).toBe('unauthenticated');
  });
});

describe('counts and results', () => {
  it('counts what the confirm button restores', () => {
    const p = preview({ conflicts: [{ title: 'A', reason: 'same_title' }] });
    expect(applyCount(p, 'skip')).toBe(11);
    expect(applyCount(p, 'rename')).toBe(12);
    const all = preview({
      recipes: 1,
      conflicts: [{ title: 'A', reason: 'same_title' }],
    });
    expect(applyCount(all, 'skip')).toBe(0);
    expect(
      applyCount(
        preview({
          recipes: 1,
          conflicts: [
            { title: 'A', reason: 'x' },
            { title: 'B', reason: 'x' },
          ],
        }),
        'skip',
      ),
    ).toBe(0);
  });
  it('splits conflicts after five', () => {
    const titles = ['1', '2', '3', '4', '5', '6', '7'];
    expect(splitConflicts(titles)).toEqual({ head: titles.slice(0, 5), rest: ['6', '7'] });
    expect(splitConflicts(['1']).rest).toEqual([]);
  });
  it('omits zero lines', () => {
    expect(resultLines(result()).map((l) => l.key)).toEqual(['imported', 'skipped', 'photos']);
    expect(
      resultLines(result({ renamed: 2, photos_failed: 1, notes_skipped: 4 })).map((l) => l.key),
    ).toEqual(['imported', 'renamed', 'skipped', 'photos', 'photosFailed', 'notesSkipped']);
  });
  it('counts copies once: `imported` includes `renamed`', () => {
    const lines = resultLines(result({ imported: 4, renamed: 4, skipped: 0 }));
    expect(lines.find((l) => l.key === 'imported')).toBeUndefined();
    expect(lines.find((l) => l.key === 'renamed')?.count).toBe(4);
    expect(resultLines(result({ imported: 9, renamed: 2 })).slice(0, 2)).toEqual([
      { key: 'imported', count: 7 },
      { key: 'renamed', count: 2 },
    ]);
  });
  it('parses untrusted bodies defensively', () => {
    expect(parseStage(null)).toBeNull();
    expect(parseStage({ id: 'x' })).toBeNull();
    const s = parseStage({
      id: 'x',
      kind: 'json',
      preview: {
        recipes: 2,
        conflicts: [{ title: 'T', reason: 'same_title' }, 5],
        unknown_users: ['a', 1],
      },
    });
    expect(s?.preview.conflicts).toEqual([{ title: 'T', reason: 'same_title' }]);
    expect(s?.preview.unknown_users).toEqual(['a']);
    expect(s?.preview.notes).toBe(0);
    expect(parseApplyResult({})).toBeNull();
    expect(parseApplyResult({ imported: 1 })?.failed_at).toBeNull();
    expect(parseApplyResult({ imported: 1, failed_at: 3 })?.failed_at).toBe(3);
  });
});

describe('restoreReducer', () => {
  const picked = (): RestoreState =>
    restoreReducer(initialRestoreState, {
      type: 'pick',
      file: { name: 'a.zip', size: 10 },
      error: null,
    });
  const previewing = (o: Partial<Preview> = {}): RestoreState => {
    let s = restoreReducer(picked(), { type: 'uploadStart' });
    s = restoreReducer(s, { type: 'staged', stage: stage(o) });
    return s;
  };

  it('keeps the file on a failed precheck out of the state', () => {
    const s = restoreReducer(initialRestoreState, {
      type: 'pick',
      file: { name: 'a.txt', size: 1 },
      error: { key: 'extension' },
    });
    expect(s.file).toBeNull();
    expect(s.error?.key).toBe('extension');
  });
  it('uploads, switches to checking at 100 %, then shows the preview focusing the caption', () => {
    let s = restoreReducer(picked(), { type: 'uploadStart' });
    expect(s.phase).toBe('uploading');
    s = restoreReducer(s, { type: 'progress', percent: 40.4 });
    expect(s).toMatchObject({ phase: 'uploading', percent: 40 });
    s = restoreReducer(s, { type: 'progress', percent: 100 });
    expect(s.phase).toBe('checking');
    s = restoreReducer(s, { type: 'staged', stage: stage() });
    expect(s.phase).toBe('preview');
    expect(s.focus?.to).toBe('caption');
    expect(s.strategy).toBe('skip');
  });
  it('does not upload without a file', () => {
    expect(restoreReducer(initialRestoreState, { type: 'uploadStart' }).phase).toBe('idle');
  });
  it('keeps the file after a failed upload and after a cancel', () => {
    const up = restoreReducer(picked(), { type: 'uploadStart' });
    const failed = restoreReducer(up, { type: 'uploadFail', error: { key: 'network' } });
    expect(failed).toMatchObject({ phase: 'idle', error: { key: 'network' } });
    expect(failed.file).not.toBeNull();
    const cancelled = restoreReducer(up, { type: 'uploadCancelled' });
    expect(cancelled).toMatchObject({ phase: 'idle', error: null });
    expect(cancelled.file).not.toBeNull();
  });
  it('blocks apply when nothing would be restored, allows it after choosing rename', () => {
    let s = previewing({ recipes: 1, conflicts: [{ title: 'A', reason: 'same_title' }] });
    expect(restoreReducer(s, { type: 'applyStart' }).phase).toBe('preview');
    s = restoreReducer(s, { type: 'strategy', strategy: 'rename' });
    expect(restoreReducer(s, { type: 'applyStart' }).phase).toBe('applying');
  });
  it('shows the result and focuses its heading', () => {
    let s = restoreReducer(previewing(), { type: 'applyStart' });
    s = restoreReducer(s, { type: 'applyOk', result: result() });
    expect(s).toMatchObject({ phase: 'result', focus: { to: 'result' } });
  });
  it('returns to the preview with the error when apply fails, to the picker when expired', () => {
    const applying = restoreReducer(previewing(), { type: 'applyStart' });
    const soft = restoreReducer(applying, { type: 'applyFail', failure: applyError(409, null) });
    expect(soft).toMatchObject({ phase: 'preview', error: { key: 'in_progress' } });
    const gone = restoreReducer(applying, { type: 'applyFail', failure: applyError(404, null) });
    expect(gone).toMatchObject({ phase: 'idle', file: null, stage: null, focus: { to: 'picker' } });
    expect(gone.error?.key).toBe('expired');
  });
  it('discard and again reset to step 1 and focus the picker', () => {
    expect(restoreReducer(previewing(), { type: 'discard' })).toMatchObject({
      phase: 'idle',
      file: null,
      stage: null,
      focus: { to: 'picker' },
    });
    expect(restoreReducer(previewing(), { type: 'again' }).phase).toBe('idle');
  });
  it('ignores stray actions in the wrong phase', () => {
    expect(restoreReducer(initialRestoreState, { type: 'staged', stage: stage() }).phase).toBe(
      'idle',
    );
    expect(restoreReducer(initialRestoreState, { type: 'applyOk', result: result() }).phase).toBe(
      'idle',
    );
    expect(restoreReducer(initialRestoreState, { type: 'progress', percent: 5 }).phase).toBe(
      'idle',
    );
  });
});
