// Pure logic behind the /backup page (UX spec section 5): request building, error mapping,
// counts and the restore state machine. No React, no fetch; everything here is unit-tested.

export type Strategy = 'skip' | 'rename';

export type Preview = {
  scope: 'own' | 'all';
  recipes: number;
  sections: number;
  ingredients: number;
  notes: number;
  ratings: number;
  photos: number;
  conflicts: Array<{ title: string; reason: string }>;
  unknown_users: string[];
  notes_skipped: number;
  ratings_skipped: number;
};

export type Stage = { id: string; kind: 'json' | 'zip'; expires_at: string; preview: Preview };

export type ApplyResult = {
  imported: number;
  skipped: number;
  renamed: number;
  notes_restored: number;
  notes_skipped: number;
  ratings_restored: number;
  ratings_skipped: number;
  photos_restored: number;
  photos_failed: number;
  failed_at: number | null;
};

export type PickedFile = { name: string; size: number };

/** A user-facing error: a catalog error key plus the server text when it sent one. */
export type RestoreError = {
  key: string;
  message?: string;
  params?: Record<string, string | number>;
  details?: string[];
};

/* ---------- export ---------- */

export function exportHref(o: { photos: boolean; all: boolean }): string {
  const q = new URLSearchParams();
  if (o.all) q.set('all', '1');
  if (o.photos) q.set('photos', '1');
  const s = q.toString();
  return s ? `/api/export?${s}` : '/api/export';
}

/* ---------- file checks ---------- */

/** `application/json` or `application/zip` by extension, else null. */
export function backupContentType(name: string): 'application/json' | 'application/zip' | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'json') return 'application/json';
  if (ext === 'zip') return 'application/zip';
  return null;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const text = i === 0 || v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return `${text} ${units[i]}`;
}

/** Fast local rejection (the server stays authoritative). */
export function precheckBackup(file: PickedFile, max: number): RestoreError | null {
  if (backupContentType(file.name) === null) return { key: 'extension' };
  if (file.size > max) return { key: 'tooLarge', params: { max: formatBytes(max) } };
  return null;
}

/* ---------- error mapping ---------- */

type Body = { error?: unknown; message?: unknown; found?: unknown; errors?: unknown } | null;

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Map a failed stage response (status 0 = no response) to one error. The server text wins. */
export function stageError(status: number, body: unknown, max: number): RestoreError {
  const b = (body && typeof body === 'object' ? body : null) as Body;
  const message = text(b?.message);
  const code = text(b?.error);
  if (status === 0 || status >= 500) return { key: 'network' };
  if (status === 401) return { key: 'unauthenticated' };
  if (status === 413) return { key: 'tooLarge', params: { max: formatBytes(max) }, message };
  if (status === 409) return { key: 'in_progress', message };
  if (status === 403) return { key: 'scope_forbidden', message };
  if (status === 415) return { key: 'extension', message };
  if (status === 422) {
    const found = b?.found;
    const foundText = typeof found === 'string' || typeof found === 'number' ? String(found) : null;
    const key =
      code === 'backup_version_unsupported'
        ? 'backup_version_unsupported'
        : code === 'backup_zip_invalid' || code === 'zip_invalid'
          ? 'zip_invalid'
          : 'backup_invalid';
    const details = Array.isArray(b?.errors)
      ? (b.errors as unknown[]).filter((e): e is string => typeof e === 'string').slice(0, 5)
      : [];
    return {
      key,
      message,
      // Shown after the message only when the server text does not already carry it.
      params:
        foundText && !(message ?? '').includes(foundText) ? { version: foundText } : undefined,
      details: details.length > 0 ? details : undefined,
    };
  }
  return { key: 'network' };
}

export type ApplyFailure = { error: RestoreError; expired: boolean };

export function applyError(status: number, body: unknown): ApplyFailure {
  const b = (body && typeof body === 'object' ? body : null) as Body;
  const message = text(b?.message);
  if (status === 404) return { error: { key: 'expired', message }, expired: true };
  if (status === 409) return { error: { key: 'in_progress', message }, expired: false };
  if (status === 401 || status === 403)
    return { error: { key: 'unauthenticated' }, expired: false };
  return { error: { key: 'network' }, expired: false };
}

/* ---------- preview and result ---------- */

/** Recipes the confirm button will restore. */
export function applyCount(preview: Preview, strategy: Strategy): number {
  return strategy === 'rename'
    ? preview.recipes
    : Math.max(0, preview.recipes - preview.conflicts.length);
}

export const PREVIEW_ROWS = ['recipes', 'sections', 'notes', 'ratings', 'photos'] as const;

/** Conflict titles shown inline; the rest goes behind a <details>. */
export const CONFLICTS_INLINE = 5;
export function splitConflicts(titles: string[]): { head: string[]; rest: string[] } {
  return { head: titles.slice(0, CONFLICTS_INLINE), rest: titles.slice(CONFLICTS_INLINE) };
}

export type ResultLine = { key: string; count: number };

/** Result lines in spec order; zero counts are omitted. */
export function resultLines(r: ApplyResult): ResultLine[] {
  // The API counts every restored recipe in `imported`, copies included (`renamed` is the subset
  // restored under a new title), so the plain line is the difference.
  const all: ResultLine[] = [
    { key: 'imported', count: Math.max(0, r.imported - r.renamed) },
    { key: 'renamed', count: r.renamed },
    { key: 'skipped', count: r.skipped },
    { key: 'photos', count: r.photos_restored },
    { key: 'photosFailed', count: r.photos_failed },
    { key: 'notesSkipped', count: r.notes_skipped },
  ];
  return all.filter((l) => l.count > 0);
}

export function isPartial(r: ApplyResult): boolean {
  return r.failed_at !== null && r.failed_at !== undefined;
}

/** Narrow an untrusted JSON body to a Stage; null when the shape is wrong. */
export function parseStage(body: unknown): Stage | null {
  const b = body as Partial<Stage> | null;
  const p = b?.preview as Partial<Preview> | undefined;
  if (!b || typeof b.id !== 'string' || !p || typeof p.recipes !== 'number') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    id: b.id,
    kind: b.kind === 'zip' ? 'zip' : 'json',
    expires_at: typeof b.expires_at === 'string' ? b.expires_at : '',
    preview: {
      scope: p.scope === 'all' ? 'all' : 'own',
      recipes: n(p.recipes),
      sections: n(p.sections),
      ingredients: n(p.ingredients),
      notes: n(p.notes),
      ratings: n(p.ratings),
      photos: n(p.photos),
      conflicts: Array.isArray(p.conflicts)
        ? p.conflicts.flatMap((c) =>
            c && typeof c.title === 'string' ? [{ title: c.title, reason: String(c.reason) }] : [],
          )
        : [],
      unknown_users: strs(p.unknown_users) as string[],
      notes_skipped: n(p.notes_skipped),
      ratings_skipped: n(p.ratings_skipped),
    },
  };
}

export function parseApplyResult(body: unknown): ApplyResult | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.imported !== 'number') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    imported: n(b.imported),
    skipped: n(b.skipped),
    renamed: n(b.renamed),
    notes_restored: n(b.notes_restored),
    notes_skipped: n(b.notes_skipped),
    ratings_restored: n(b.ratings_restored),
    ratings_skipped: n(b.ratings_skipped),
    photos_restored: n(b.photos_restored),
    photos_failed: n(b.photos_failed),
    failed_at: typeof b.failed_at === 'number' ? b.failed_at : null,
  };
}

/* ---------- state machine ---------- */

export type Phase = 'idle' | 'uploading' | 'checking' | 'preview' | 'applying' | 'result';
export type FocusTarget = 'picker' | 'caption' | 'result';

export type RestoreState = {
  phase: Phase;
  file: PickedFile | null;
  percent: number;
  error: RestoreError | null;
  stage: Stage | null;
  strategy: Strategy;
  result: ApplyResult | null;
  /** Where focus goes after the next render; `seq` lets a repeat target fire again. */
  focus: { to: FocusTarget; seq: number } | null;
};

export const initialRestoreState: RestoreState = {
  phase: 'idle',
  file: null,
  percent: 0,
  error: null,
  stage: null,
  strategy: 'skip',
  result: null,
  focus: null,
};

export type RestoreAction =
  | { type: 'pick'; file: PickedFile | null; error: RestoreError | null }
  | { type: 'uploadStart' }
  | { type: 'progress'; percent: number }
  | { type: 'uploadCancelled' }
  | { type: 'uploadFail'; error: RestoreError }
  | { type: 'staged'; stage: Stage }
  | { type: 'strategy'; strategy: Strategy }
  | { type: 'applyStart' }
  | { type: 'applyOk'; result: ApplyResult }
  | { type: 'applyFail'; failure: ApplyFailure }
  | { type: 'discard' }
  | { type: 'again' };

const focusOn = (s: RestoreState, to: FocusTarget) => ({ to, seq: (s.focus?.seq ?? 0) + 1 });

export function restoreReducer(s: RestoreState, a: RestoreAction): RestoreState {
  switch (a.type) {
    case 'pick':
      if (s.phase !== 'idle') return s;
      return { ...s, file: a.error ? null : a.file, error: a.error, percent: 0 };
    case 'uploadStart':
      if (s.phase !== 'idle' || !s.file) return s;
      return { ...s, phase: 'uploading', percent: 0, error: null };
    case 'progress': {
      if (s.phase !== 'uploading') return s;
      const percent = Math.max(0, Math.min(100, Math.round(a.percent)));
      // Bytes are all sent: the server is now validating.
      return { ...s, percent, phase: percent >= 100 ? 'checking' : 'uploading' };
    }
    case 'uploadCancelled':
      if (s.phase !== 'uploading' && s.phase !== 'checking') return s;
      return { ...s, phase: 'idle', percent: 0, error: null };
    case 'uploadFail':
      if (s.phase !== 'uploading' && s.phase !== 'checking') return s;
      return { ...s, phase: 'idle', percent: 0, error: a.error };
    case 'staged':
      if (s.phase !== 'uploading' && s.phase !== 'checking') return s;
      return {
        ...s,
        phase: 'preview',
        stage: a.stage,
        strategy: 'skip',
        error: null,
        focus: focusOn(s, 'caption'),
      };
    case 'strategy':
      return s.phase === 'preview' ? { ...s, strategy: a.strategy, error: null } : s;
    case 'applyStart':
      if (s.phase !== 'preview' || !s.stage) return s;
      if (applyCount(s.stage.preview, s.strategy) === 0) return s;
      return { ...s, phase: 'applying', error: null };
    case 'applyOk':
      if (s.phase !== 'applying') return s;
      return { ...s, phase: 'result', result: a.result, focus: focusOn(s, 'result') };
    case 'applyFail':
      if (s.phase !== 'applying') return s;
      if (a.failure.expired) {
        return {
          ...initialRestoreState,
          error: a.failure.error,
          focus: focusOn(s, 'picker'),
        };
      }
      return { ...s, phase: 'preview', error: a.failure.error };
    case 'discard':
    case 'again':
      return { ...initialRestoreState, focus: focusOn(s, 'picker') };
  }
}
