'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Visibility } from '@/lib/recipes/schemas';
import { call } from '../api';
import {
  copyPlan,
  initialShareState,
  linkIsOn,
  shareReducer,
  statusDuration,
  type ShareState,
} from './share-state';

async function readJson(res: Response | null): Promise<Record<string, unknown>> {
  try {
    return res ? ((await res.json()) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** All share dialog state and requests. Lives in the Share button so a request outlives a close. */
export function useShare(
  id: string,
  initial: { visibility: Visibility; url: string | null; linksEnabled: boolean },
  onSettled: () => void,
) {
  const [state, dispatch] = useReducer(shareReducer, initial, initialShareState);
  const ref = useRef<ShareState>(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  // Transient statuses ("Link copied.") fall back to the summary sentence.
  useEffect(() => {
    const ms = statusDuration(state.status);
    if (ms === null) return;
    const timer = setTimeout(() => dispatch({ type: 'status', status: 'summary' }), ms);
    return () => clearTimeout(timer);
  }, [state.status]);

  const setVisibility = useCallback(
    async (next: Visibility) => {
      const prev = ref.current.visibility;
      if (next === prev) return;
      dispatch({ type: 'visibilityStart', next });
      const res = await call(`/api/recipes/${id}/visibility`, 'PUT', { visibility: next });
      if (res?.ok) {
        dispatch({ type: 'visibilityOk' });
        settled.current();
      } else dispatch({ type: 'visibilityFail', prev, httpStatus: res?.status ?? null });
    },
    [id],
  );

  /** Create (off to on) or rotate: the same POST. */
  const makeLink = useCallback(
    async (which: 'on' | 'rotate') => {
      dispatch({ type: 'linkStart', which });
      const res = await call(`/api/recipes/${id}/share-link`, 'POST');
      const body = await readJson(res);
      const url = (body.share as { url?: unknown } | undefined)?.url;
      if (res?.status === 201 && typeof url === 'string') {
        dispatch({ type: 'linkUrl', url, rotated: which === 'rotate' });
        settled.current();
      } else {
        dispatch({
          type: 'linkFail',
          which,
          httpStatus: res?.status ?? null,
          code: typeof body.error === 'string' ? body.error : undefined,
        });
      }
    },
    [id],
  );

  const revoke = useCallback(async () => {
    dispatch({ type: 'linkStart', which: 'off' });
    const res = await call(`/api/recipes/${id}/share-link`, 'DELETE');
    if (res?.status === 204) {
      dispatch({ type: 'linkRevoked' });
      settled.current();
    } else {
      const body = await readJson(res);
      dispatch({
        type: 'linkFail',
        which: 'off',
        httpStatus: res?.status ?? null,
        code: typeof body.error === 'string' ? body.error : undefined,
      });
    }
  }, [id]);

  /** Copy the link; without the clipboard API select the field instead (no execCommand). */
  const copy = useCallback(async (field: HTMLInputElement | null) => {
    const url = ref.current.url;
    if (!url) return;
    const coarse =
      typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
    const plan = copyPlan(
      typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function',
      coarse,
    );
    if (plan === 'clipboard') {
      try {
        await navigator.clipboard.writeText(url);
        dispatch({ type: 'status', status: 'copied' });
        return;
      } catch {
        // denied: fall through to the manual path
      }
    }
    field?.focus();
    field?.select();
    dispatch({ type: 'status', status: plan === 'manualTouch' ? 'copyManualTouch' : 'copyManual' });
  }, []);

  return {
    state,
    dispatch,
    linkOn: linkIsOn(state),
    setVisibility,
    makeLink,
    revoke,
    copy,
  };
}
