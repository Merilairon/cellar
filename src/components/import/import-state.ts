import { IMPORT_ERROR_CODES, type ImportErrorCode } from '@/lib/import/errors';

// Pure state machine for the import dialog (no react, no fetch).

export type Tab = 'url' | 'paste';
export type Phase = 'fetching' | 'parsing';

export type ImportFailure =
  | { kind: 'code'; code: ImportErrorCode }
  | { kind: 'rateLimited'; seconds: number }
  | { kind: 'network' }
  | { kind: 'generic' };

export type DialogState = {
  tab: Tab;
  /** Both inputs survive a failure and a tab switch. */
  url: string;
  text: string;
  /** Non-null while a request is in flight. */
  busy: Phase | null;
  error: ImportFailure | null;
  /** Bumped when the paste textarea should take focus (recovery after a failed URL import). */
  pasteFocus: number;
};

export type DialogAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'url'; value: string }
  | { type: 'text'; value: string }
  | { type: 'submit' }
  | { type: 'phase'; phase: Phase }
  | { type: 'failed'; failure: ImportFailure }
  | { type: 'cancel' }
  | { type: 'done' };

export const initialState: DialogState = {
  tab: 'url',
  url: '',
  text: '',
  busy: null,
  error: null,
  pasteFocus: 0,
};

/** Codes after which pasting the recipe is the way forward. */
const PASTE_RECOVERY = new Set<ImportErrorCode>([
  'blocked',
  'no_recipe',
  'timeout',
  'fetch_failed',
]);
export const suggestsPaste = (f: ImportFailure): boolean =>
  f.kind === 'code' && PASTE_RECOVERY.has(f.code);

export function reducer(s: DialogState, a: DialogAction): DialogState {
  switch (a.type) {
    case 'tab':
      return s.busy ? s : { ...s, tab: a.tab };
    case 'url':
      return { ...s, url: a.value };
    case 'text':
      return { ...s, text: a.value };
    case 'submit':
      if (s.busy) return s; // double submit
      return { ...s, error: null, busy: s.tab === 'url' ? 'fetching' : 'parsing' };
    case 'phase':
      return s.busy ? { ...s, busy: a.phase } : s;
    case 'failed': {
      if (!s.busy) return s;
      const toPaste = s.tab === 'url' && suggestsPaste(a.failure);
      return {
        ...s,
        busy: null,
        error: a.failure,
        tab: toPaste ? 'paste' : s.tab,
        pasteFocus: toPaste ? s.pasteFocus + 1 : s.pasteFocus,
      };
    }
    case 'cancel':
      return { ...s, busy: null };
    case 'done':
      return { ...s, busy: null };
  }
}

const isCode = (v: unknown): v is ImportErrorCode =>
  typeof v === 'string' && (IMPORT_ERROR_CODES as readonly string[]).includes(v);

export type Outcome = { ok: true; id: string } | { ok: false; failure: ImportFailure };

/** Maps the POST /api/import response (status, JSON body, Retry-After) to an outcome. */
export function classifyResponse(
  status: number,
  body: unknown,
  retryAfter: string | null,
): Outcome {
  if (status === 429) {
    const n = Number(retryAfter);
    return {
      ok: false,
      failure: { kind: 'rateLimited', seconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60 },
    };
  }
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  if (status === 200 && b) {
    if (b.status === 'needs_review' && typeof b.id === 'string' && b.draft) {
      return { ok: true, id: b.id };
    }
    if (isCode(b.error_code)) return { ok: false, failure: { kind: 'code', code: b.error_code } };
  }
  return { ok: false, failure: { kind: 'generic' } };
}
