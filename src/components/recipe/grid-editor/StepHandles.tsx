'use client';

import { useTranslations } from 'next-intl';
import type { Span } from '@/lib/grid/editor';
import { sliderKey, type Edge } from './span-drag';

export type StepHandlesProps = {
  label: string;
  stepKey: string;
  /** Current span, 0-based inclusive. */
  span: Span;
  /** Ingredient names of the section, in row order. */
  names: string[];
  onBegin: (e: React.PointerEvent<HTMLElement>, edge: Edge) => void;
  /** Slider keys (arrows, PageUp/Down, Home/End) on a focused handle. */
  onSlide: (edge: Edge, span: Span) => void;
};

/**
 * Top and bottom span handles of one step cell (UX spec 4.1 to 4.4). Each is a vertical
 * `role="slider"`, never a tab stop (`tabindex=-1`); the keyboard path is the chord on the step
 * cell and the Adjust rows panel. Visibility, size and touch rules are CSS (`.ge-handle`).
 */
export function StepHandles({ label, stepKey, span, names, onBegin, onSlide }: StepHandlesProps) {
  const t = useTranslations();
  const n = names.length;
  const one = (edge: Edge) => {
    const row = edge === 'start' ? span.start : span.end;
    return (
      <div
        role="slider"
        tabIndex={-1}
        aria-orientation="vertical"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={row + 1}
        aria-valuetext={t('gridEditor.step.handleValue', { n: row + 1, name: names[row] ?? '' })}
        aria-label={
          edge === 'start'
            ? t('gridEditor.step.handleStart', { label })
            : t('gridEditor.step.handleEnd', { label })
        }
        className="ge-handle"
        data-edge={edge}
        data-ge-handle={`${stepKey}:${edge}`}
        onPointerDown={(e) => onBegin(e, edge)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          const next = sliderKey(edge, e.key, span, n);
          if (!next) return;
          e.preventDefault();
          e.stopPropagation();
          onSlide(edge, next);
        }}
      >
        <span aria-hidden="true" className="ge-grip" />
      </div>
    );
  };
  return (
    <>
      {one('start')}
      {one('end')}
    </>
  );
}
