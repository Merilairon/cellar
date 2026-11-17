'use client';

import { useEffect, useRef } from 'react';
import { RestoreView } from './RestoreView';
import { useRestore } from './useRestore';

/** Restore section wiring: request state from `useRestore`, focus moves per UX spec 5.3. */
export function RestorePanel({ role, maxBytes }: { role: 'admin' | 'member'; maxBytes: number }) {
  const r = useRestore(maxBytes);
  const pickerRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const focus = r.state.focus;

  useEffect(() => {
    if (!focus) return;
    const el = { picker: pickerRef, caption: captionRef, result: resultRef }[focus.to].current;
    el?.focus();
    // `seq` makes a repeated target fire again.
  }, [focus]);

  // The input keeps a stale value after discard/reset; clear it so the same file can be picked again.
  useEffect(() => {
    if (r.state.file === null && pickerRef.current) pickerRef.current.value = '';
  }, [r.state.file]);

  return (
    <RestoreView
      state={r.state}
      role={role}
      dispatch={r.dispatch}
      onPick={r.pick}
      onCheck={r.check}
      onCancelUpload={r.cancelUpload}
      onApply={r.apply}
      onDiscard={r.discard}
      onAgain={r.again}
      pickerRef={pickerRef}
      captionRef={captionRef}
      resultRef={resultRef}
    />
  );
}
