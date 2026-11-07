'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import {
  doc,
  isDirty,
  type EditorAction,
  type EditorDoc,
  type EditorIssue,
  type EditorState,
} from '@/lib/grid/editor';
import { call } from '../api';
import { runGridSave } from './save-request';
import type { ApiRecipe } from '../types';

export type SavePhase = 'idle' | 'saving' | 'network' | 'conflict' | 'reload';
export type ConflictConfirm = null | 'load' | 'overwrite';

type Say = (
  m: string,
  kind: 'saving' | 'saved' | 'savedList' | 'rejected' | 'loaded' | 'failed',
) => void;

/**
 * T9: the save request, its four outcomes and the leave guard.
 *
 * - 200: the response is the new recipe (new `updated_at`, new ids, G4). It becomes the next
 *   `base_updated_at` and goes to `onRecipe`; `markSaved` carries the sent document and the
 *   reducer applies it only if that is still the present one (edits made while the request was
 *   in flight stay dirty). History is kept (Q9). A 200 with an unreadable body is refetched;
 *   if that fails too the phase is `reload` (saved, reload to continue), never a retry.
 * - 422: the paths are mapped onto the SENT document and kept with it, so they show only while
 *   the document is still that one.
 * - 409: the server's current stamp is held so "Save mine anyway" can reuse it.
 * - anything else (network, 5xx, 401/403/404): a retry alert; nothing is lost.
 *
 * O6 (in-app navigation while dirty): Next 16 has no global navigation-blocking hook (no
 * router events, no `useBlocker`; `<Link onNavigate>` is per link and does not see history).
 * Two guards cover what can be covered:
 * - `beforeunload` (below): reload, tab close, address-bar navigation.
 * - `useLeaveGuard` (called by the editor, same `dirty`): browser Back, Android back and the iOS
 *   edge swipe. While dirty it keeps one extra history entry; Back pops it, the guard pushes it
 *   again and opens the editor's leave confirm. The entry is removed when the document is clean
 *   (saved, undone) or the editor closes, so Done leaves no extra entry behind.
 * Known gap: the header links (logo, nav, user menu) are plain `<Link>`s outside the editor and
 *   still leave without asking. The sticky "Unsaved changes" dot is the mitigation. Carryover.
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
  // F3: "Keep editing" leaves the stale base in place, so the next Save asks again. True from
  // that choice until a save or "Load the latest" succeeds; the editor shows a note meanwhile.
  const [kept, setKept] = useState(false);
  const [rejected, setRejected] = useState<{ doc: EditorDoc; errors: EditorIssue[] } | null>(null);
  // Bumped on every outcome that needs focus; the component focuses the right element.
  const [focusTick, setFocusTick] = useState<{ n: number; what: 'issues' | 'conflict' | 'alert' }>({
    n: 0,
    what: 'issues',
  });

  // Assigned during render so `save` never reads a state older than the one on screen.
  const latest = useRef(editor);
  // eslint-disable-next-line react-hooks/refs -- intentional: the freshest state for `save`
  latest.current = editor;
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
        const out = await runGridSave(recipeId, sent, baseOverride ?? base);
        switch (out.kind) {
          case 'saved': {
            const r = out.recipe;
            setBase(r.updated_at);
            setRejected(null);
            setConflictStamp(null);
            setKept(false);
            setPhase('idle');
            // The reducer applies this only while the present document is still `sent`.
            dispatch({ type: 'markSaved', doc: doc(sent) });
            onRecipe?.(r);
            say('', r.view_mode === 'list' ? 'savedList' : 'saved');
            return;
          }
          case 'savedUnreadable':
            // Written, but no new stamp: saved is saved; the page must reload for the new base.
            setRejected(null);
            setConflictStamp(null);
            setKept(false);
            setPhase('reload');
            dispatch({ type: 'markSaved', doc: doc(sent) });
            focusOn('alert');
            return;
          case 'rejected':
            setRejected({ doc: out.doc, errors: out.errors });
            setPhase('idle');
            say(String(out.errors.length), 'rejected');
            focusOn('issues');
            return;
          case 'conflict':
            setConflictStamp(out.stamp);
            setPhase('conflict');
            focusOn('conflict');
            return;
          case 'failed':
            setPhase('network');
            say('', 'failed');
            focusOn('alert');
            return;
        }
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
    setKept(false);
    setPhase('idle');
    onRecipe?.(r);
    say('', 'loaded');
  }, [dispatch, onRecipe, recipeId, say]);

  const keepEditing = () => {
    setKept(true);
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
    kept,
    /** Server errors, only while the document is the one they were mapped against. */
    rejected: rejected && rejected.doc === doc(editor) ? rejected.errors : [],
    focusTick,
  };
}
