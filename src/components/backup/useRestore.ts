'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { initialRestoreState, precheckBackup, restoreReducer } from './backup-logic';
import { applyBackup, discardBackup, stageBackup } from './restore-api';

/** All restore state and requests. The File itself lives in a ref; the reducer holds its metadata. */
export function useRestore(max: number) {
  const [state, dispatch] = useReducer(restoreReducer, initialRestoreState);
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const live = useRef(state);
  useEffect(() => {
    live.current = state;
  }, [state]);
  // Leaving the page mid-upload aborts the request.
  useEffect(() => () => abortRef.current?.(), []);

  const pick = useCallback(
    (file: File | null) => {
      fileRef.current = null;
      if (!file) return dispatch({ type: 'pick', file: null, error: null });
      const meta = { name: file.name, size: file.size };
      const error = precheckBackup(meta, max);
      if (!error) fileRef.current = file;
      dispatch({ type: 'pick', file: meta, error });
    },
    [max],
  );

  const check = useCallback(async () => {
    const file = fileRef.current;
    if (!file || live.current.phase !== 'idle') return;
    dispatch({ type: 'uploadStart' });
    const req = stageBackup(file, max, (percent) => dispatch({ type: 'progress', percent }));
    abortRef.current = req.abort;
    const out = await req.promise;
    abortRef.current = null;
    if (out.ok) dispatch({ type: 'staged', stage: out.stage });
    else if (out.aborted) dispatch({ type: 'uploadCancelled' });
    else dispatch({ type: 'uploadFail', error: out.error });
  }, [max]);

  const cancelUpload = useCallback(() => abortRef.current?.(), []);

  const apply = useCallback(async () => {
    const { stage, strategy } = live.current;
    if (!stage || live.current.phase !== 'preview') return;
    dispatch({ type: 'applyStart' });
    const out = await applyBackup(stage.id, strategy);
    if (out.ok) dispatch({ type: 'applyOk', result: out.result });
    else dispatch({ type: 'applyFail', failure: out.failure });
  }, []);

  const discard = useCallback(() => {
    const stage = live.current.stage;
    fileRef.current = null;
    dispatch({ type: 'discard' });
    if (stage) void discardBackup(stage.id);
  }, []);

  const again = useCallback(() => {
    fileRef.current = null;
    dispatch({ type: 'again' });
  }, []);

  return { state, dispatch, pick, check, cancelUpload, apply, discard, again };
}
