'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import {
  doc,
  isDirty,
  mapServerErrors,
  toGridPayload,
  type EditorAction,
  type EditorDoc,
  type EditorIssue,
  type EditorState,
} from '@/lib/grid/editor';
import type { GridIssue } from '@/lib/grid/validate';
import { call } from '../api';
import type { ApiRecipe } from '../types';

export type SavePhase = 'idle' | 'saving' | 'network' | 'conflict';
export type ConflictConfirm = null | 'load' | 'overwrite';

type Say = (
  m: string,
  kind: 'saving' | 'saved' | 'savedList' | 'rejected' | 'loaded' | 'failed',
) => void;

/**
 * T9: the save request, its four outcomes and the leave guard.
 *
 * - 200: the response is the new recipe (new `updated_at`, new ids, G4). It becomes the next
 *   `base_updated_at` and goes to `onRecipe`; `markSaved` runs only if the document is still
 *   the one that was sent (edits made while the request was in flight stay dirty). History is
 *   kept (Q9).
 * - 422: the paths are mapped onto the current document; they stay until the next edit.
 * - 409: the server's current stamp is held so "Save mine anyway" can reuse it.
 * - anything else (network, 5xx, 401/403/404): a retry alert; nothing is lost.
 *
 * O6 (in-app navigation while dirty): Next 16 has no global navigation-blocking hook
 * (no router events, no `useBlocker`; `<Link onNavigate>` is per link and does not see
 * history/back). Only `beforeunload` is registered; clicking a header link while dirty can
 * lose edits. The sticky "Unsaved changes" dot is the mitigation. Gap recorded for the
 * carryover file.
 */
export function useSaveFlow({
  recipeId,
  initialBase,
  editor,
  dispatch,
  onRecipe,
  say,
}: {
  recipeId: string;
  initialBase: string;
  editor: EditorState;
  dispatch: Dispatch<EditorAction>;
  onRecipe?: (r: ApiRecipe) => void;
  say: Say;
}) {
  const [base, setBase] = useState(initialBase);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [conflictStamp, setConflictStamp] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConflictConfirm>(null);
  const [rejected, setRejected] = useState<{ doc: EditorDoc; errors: EditorIssue[] } | null>(null);
  // Bumped on every outcome that needs focus; the component focuses the right element.
  const [focusTick, setFocusTick] = useState<{ n: number; what: 'issues' | 'conflict' | 'alert' }>({
    n: 0,
    what: 'issues',
  });

  const latest = useRef(editor);
  useEffect(() => {
    latest.current = editor;
  }, [editor]);
  const inFlight = useRef(false);
  const dirty = isDirty(editor);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const focusOn = (what: 'issues' | 'conflict' | 'alert') =>
    setFocusTick((p) => ({ n: p.n + 1, what }));

  const save = useCallback(
    async (baseOverride?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const sent = latest.current;
      setPhase('saving');
      setConfirm(null);
      say('', 'saving');
      try {
        const res = await call(
          `/api/recipes/${recipeId}/grid`,
          'PUT',
          toGridPayload(sent, baseOverride ?? base),
        );
        if (res?.status === 200) {
          const r = (await res.json().catch(() => null)) as ApiRecipe | null;
          if (r && typeof r.updated_at === 'string') {
            setBase(r.updated_at);
            setRejected(null);
            setConflictStamp(null);
            setPhase('idle');
            if (doc(latest.current) === doc(sent)) dispatch({ type: 'markSaved' });
            onRecipe?.(r);
            say('', r.view_mode === 'list' ? 'savedList' : 'saved');
            return;
          }
        } else if (res?.status === 422) {
          const body = (await res.json().catch(() => null)) as { errors?: GridIssue[] } | null;
          if (Array.isArray(body?.errors)) {
            const d = doc(latest.current);
            const errors = mapServerErrors(d, body.errors);
            setRejected({ doc: d, errors });
            setPhase('idle');
            say(String(errors.length), 'rejected');
            focusOn('issues');
            return;
          }
        } else if (res?.status === 409) {
          const body = (await res.json().catch(() => null)) as { updated_at?: string } | null;
          if (typeof body?.updated_at === 'string') {
            setConflictStamp(body.updated_at);
            setPhase('conflict');
            focusOn('conflict');
            return;
          }
        }
        setPhase('network');
        say('', 'failed');
        focusOn('alert');
      } finally {
        inFlight.current = false;
      }
    },
    [base, dispatch, onRecipe, recipeId, say],
  );

  const loadLatest = useCallback(async () => {
    const res = await call(`/api/recipes/${recipeId}`, 'GET');
    const r =
      res?.status === 200 ? ((await res.json().catch(() => null)) as ApiRecipe | null) : null;
    if (!r || typeof r.updated_at !== 'string') {
      setConfirm(null);
      setPhase('network');
      say('', 'failed');
      focusOn('alert');
      return;
    }
    dispatch({ type: 'reset', recipe: r });
    setBase(r.updated_at);
    setRejected(null);
    setConflictStamp(null);
    setConfirm(null);
    setPhase('idle');
    onRecipe?.(r);
    say('', 'loaded');
  }, [dispatch, onRecipe, recipeId, say]);

  const keepEditing = () => {
    setConfirm(null);
    setPhase('idle');
  };

  return {
    phase,
    saving: phase === 'saving',
    dirty,
    conflictStamp,
    confirm,
    setConfirm,
    save,
    saveMine: () => (conflictStamp ? save(conflictStamp) : undefined),
    loadLatest,
    keepEditing,
    /** Server errors, only while the document is the one they were mapped against. */
    rejected: rejected && rejected.doc === doc(editor) ? rejected.errors : [],
    focusTick,
  };
}
