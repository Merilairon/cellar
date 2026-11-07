'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Span } from '@/lib/grid/editor';
import {
  IDLE,
  autoScrollSpeed,
  dragCancel,
  dragEnd,
  dragMove,
  dragStart,
  type DragState,
  type Edge,
  type RowRect,
} from './span-drag';

export type DragBegin = {
  sectionKey: string;
  stepKey: string;
  edge: Edge;
  origin: Span;
  rows: number;
};

export type DragPreview = { sectionKey: string; stepKey: string; start: number; end: number };

/** Height of the sticky toolbar, subtracted from the top auto-scroll zone. */
const TOOLBAR_INSET = 56;

/**
 * Pointer drag of a span handle (UX spec 4.2): pointer capture on the handle, 3 px threshold,
 * snapping from the table's ingredient row rects, one commit on pointer up, Escape /
 * pointercancel / lost capture restore. All rules live in `span-drag.ts`; this hook only
 * wires them to the DOM. Nothing is dispatched while dragging.
 */
export function useSpanDrag(opts: {
  onSelect: (stepKey: string) => void;
  onCommit: (a: { sectionKey: string; stepKey: string; span: Span }) => void;
}) {
  const [state, setState] = useState<DragState>(IDLE);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const teardown = useRef<(() => void) | null>(null);
  useEffect(() => () => teardown.current?.(), []);

  const begin = useCallback((e: React.PointerEvent<HTMLElement>, a: DragBegin) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const handle = e.currentTarget;
    const table = handle.closest('table');
    if (!table) return;
    e.preventDefault();
    teardown.current?.();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort (synthetic events) */
    }
    optsRef.current.onSelect(a.stepKey);

    const rects = (): RowRect[] =>
      Array.from(table.querySelectorAll<HTMLElement>('tbody th.ge-ing')).map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });

    let s: DragState = dragStart(a, e.clientY);
    let lastX = e.clientX;
    let lastY = e.clientY;
    let frame = 0;
    let done = false;
    setState(s);
    setPointer({ x: lastX, y: lastY });

    const update = () => {
      s = dragMove(s, lastY, rects());
      setState(s);
      setPointer({ x: lastX, y: lastY });
    };
    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      update();
    };
    const tick = () => {
      if (done) return;
      if (s.phase === 'dragging') {
        const v = autoScrollSpeed(lastY, window.innerHeight, TOOLBAR_INSET);
        if (v !== 0) {
          window.scrollBy(0, v);
          update();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      handle.removeEventListener('lostpointercapture', onCancel);
      document.removeEventListener('keydown', onKey, true);
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      teardown.current = null;
      const res = commit ? dragEnd(s) : { state: dragCancel(), commit: null };
      setState(res.state);
      setPointer(null);
      if (res.commit) {
        optsRef.current.onCommit({
          sectionKey: a.sectionKey,
          stepKey: a.stepKey,
          span: res.commit,
        });
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // Consumed: it must not also close a panel or sheet.
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    handle.addEventListener('lostpointercapture', onCancel);
    document.addEventListener('keydown', onKey, true);
    frame = requestAnimationFrame(tick);
    teardown.current = () => finish(false);
  }, []);

  const preview: DragPreview | null =
    state.phase === 'dragging'
      ? {
          sectionKey: state.sectionKey,
          stepKey: state.stepKey,
          start: state.preview.start,
          end: state.preview.end,
        }
      : null;
  return { begin, preview, pointer: preview ? pointer : null };
}
