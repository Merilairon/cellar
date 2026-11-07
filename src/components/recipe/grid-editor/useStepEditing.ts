'use client';

import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import {
  canAddColumnStep,
  canAddStep,
  doc,
  reduce,
  type EditorAction,
  type EditorSection,
  type EditorState,
  type EditorStep,
  type Span,
  type StepKind,
} from '@/lib/grid/editor';
import { bannerId, rowId, stepId, type RovingTarget } from './roving';
import { stepChord, type NoopReason } from './step-chords';
import type { Edge } from './span-drag';
import type { ResizeType, StepPanelApi } from './StepPanel';
import { byAttr, byTarget } from './useFocusLater';

type Params = {
  editor: EditorState;
  dispatch: (a: EditorAction) => void;
  say: (m: string) => void;
  focusLater: (finder: () => HTMLElement | null) => void;
  root: RefObject<HTMLElement | null>;
  showToast: (message: string, onUndo: () => void) => void;
};

const targetOfStep = (s: EditorStep) => (s.kind === 'column' ? stepId(s.key) : bannerId(s.key));

/**
 * Step editing for the grid editor (T6): chords, delete with Undo, add, convert, move, span
 * commits from drag / slider / stepper. Every action is one reducer action (one undo step).
 * Messages are computed from the reducer's next document so the announcement states the
 * result, not the intent. Pure decisions live in `step-chords.ts` and `span-drag.ts`.
 */
export function useStepEditing({ editor, dispatch, say, focusLater, root, showToast }: Params) {
  const t = useTranslations();
  const d = doc(editor);

  // `say` is the editor's `announce`: it leaves the message as `lead`, so the session's
  // uncovered-rows sentence is appended to it rather than replacing it.
  const speak = say;

  const labelOf = (s: EditorStep) =>
    s.label.trim() ||
    (s.kind === 'column' ? t('gridEditor.step.newLabel') : t('gridEditor.banner.empty'));
  const rowsText = (a: number, b: number) =>
    a === b
      ? t('gridEditor.step.rowOne', { a: a + 1 })
      : t('gridEditor.step.rowMany', { a: a + 1, b: b + 1 });
  const coversText = (sec: EditorSection, s: EditorStep) => {
    const a = s.row_start ?? 0;
    const b = s.row_end ?? 0;
    const name = (i: number) => sec.ingredients[i]?.name || '...';
    return a === b
      ? t('gridEditor.step.coversOne', { label: labelOf(s), a: a + 1, name: name(a) })
      : t('gridEditor.step.coversMany', {
          label: labelOf(s),
          a: a + 1,
          b: b + 1,
          first: name(a),
          last: name(b),
        });
  };
  const noopText = (reason: NoopReason, label: string) =>
    ({
      startAtFirst: t('gridEditor.step.noopStartAtFirst', { label }),
      endAtLast: t('gridEditor.step.noopEndAtLast', { label }),
      minOneRow: t('gridEditor.step.noopMinOneRow', { label }),
      columnEdge: t('gridEditor.step.noopNoMove', { label }),
      bannerEdge: t('gridEditor.step.noopNoMove', { label }),
      spanEdge: t('gridEditor.step.noopNoMove', { label }),
    })[reason];

  const find = (sectionKey: string, stepKey: string) => {
    const si = d.sections.findIndex((s) => s.key === sectionKey);
    const sec = d.sections[si];
    const idx = sec ? sec.steps.findIndex((s) => s.key === stepKey) : -1;
    return si >= 0 && idx >= 0 ? { si, sec, idx, step: sec.steps[idx] } : null;
  };

  const refocusStep = (s: EditorStep) => focusLater(byTarget(root, targetOfStep(s)));

  /** Dispatch `action`, then speak `message(nextSection)`. Returns the next state, or null. */
  const apply = (
    action: EditorAction,
    si: number,
    message: (next: EditorSection) => string | null,
  ): EditorState | null => {
    const next = reduce(editor, action);
    if (next === editor) return null;
    dispatch(action);
    const m = message(doc(next).sections[si]);
    if (m) speak(m);
    return next;
  };

  const resizeAnnounce = (stepKey: string) => (next: EditorSection) => {
    const s = next.steps.find((x) => x.key === stepKey);
    return s ? coversText(next, s) : null;
  };

  const spanTo = (
    si: number,
    idx: number,
    step: EditorStep,
    span: Span,
    finder?: () => HTMLElement | null,
  ) => {
    const res = apply(
      { type: 'stepSetSpan', section: si, step: idx, start: span.start, end: span.end },
      si,
      resizeAnnounce(step.key),
    );
    if (res) focusLater(finder ?? (() => byTarget(root, stepId(step.key))()));
  };

  // ---- delete ---------------------------------------------------------------------------

  const remove = (si: number, idx: number) => {
    const sec = d.sections[si];
    const step = sec?.steps[idx];
    if (!step) return;
    const group = sec.steps.filter((s) => s.kind === step.kind);
    const gi = group.indexOf(step);
    const sibling = group[gi + 1] ?? group[gi - 1];
    const fallback = sibling
      ? targetOfStep(sibling)
      : sec.ingredients[0]
        ? rowId(sec.ingredients[0].key)
        : null;
    const lastColumn =
      step.kind === 'column' && sec.steps.filter((s) => s.kind === 'column').length === 1;
    const label = labelOf(step);
    const message =
      step.kind === 'column'
        ? t('gridEditor.step.deleted', { label })
        : t('gridEditor.banner.deleted', { label });
    dispatch({ type: 'stepDelete', section: si, step: idx });
    speak(lastColumn ? `${message} ${t('gridEditor.step.lastColumn')}` : message);
    if (fallback) focusLater(byTarget(root, fallback));
    showToast(message, () => {
      dispatch({ type: 'undo' });
      focusLater(byTarget(root, targetOfStep(step)));
    });
  };

  // ---- add ------------------------------------------------------------------------------

  const addStep = (si: number) => {
    if (!canAddColumnStep(editor, si)) return;
    const action: EditorAction = {
      type: 'stepAdd',
      section: si,
      step: { label: t('gridEditor.step.newLabel') },
    };
    const next = reduce(editor, action);
    const key = next.selection.stepKey;
    const res = apply(action, si, (sec) => {
      const s = sec.steps.find((x) => x.key === key);
      return s
        ? t('gridEditor.step.added', {
            label: labelOf(s),
            rows: rowsText(s.row_start ?? 0, s.row_end ?? 0),
          })
        : null;
    });
    if (res && key) focusLater(labelFinder(key));
  };

  const addBanner = (si: number, kind: 'banner_top' | 'banner_bottom') => {
    if (!canAddStep(editor, si)) return;
    const action: EditorAction = { type: 'bannerAdd', section: si, kind };
    const key = reduce(editor, action).selection.stepKey;
    const res = apply(action, si, () =>
      t('gridEditor.banner.added', { where: kind === 'banner_top' ? 'top' : 'bottom' }),
    );
    if (res && key) focusLater(labelFinder(key));
  };

  const labelFinder = (key: string) => () => {
    const el = byAttr(root, 'data-ge-field', `label:${key}`)();
    // F4: on the phone the label sits in the closed "Step details" disclosure; open it so the
    // field can take focus.
    const details = el?.closest('details');
    if (details && !details.open) details.open = true;
    if (el) queueMicrotask(() => (el as HTMLInputElement).select?.());
    return el;
  };

  // ---- chords, drag, slider ---------------------------------------------------------------

  const chord = (si: number) => (e: React.KeyboardEvent, target: RovingTarget) => {
    const sec = d.sections[si];
    if (!sec) return false;
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      !(e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) &&
      target.kind !== 'row'
    ) {
      const idx = sec.steps.findIndex((s) => s.key === target.key);
      if (idx < 0) return false;
      e.preventDefault();
      remove(si, idx);
      return true;
    }
    const res = stepChord(e, target, sec, si);
    if (!res.handled) return false;
    e.preventDefault();
    const step = sec.steps.find((s) => s.key === (target.kind === 'row' ? '' : target.key));
    if (res.action) {
      const a = res.action;
      const message = (next: EditorSection) => {
        if (!step) return null;
        if (a.type === 'stepMove') {
          const group = next.steps.filter((s) => s.kind === step.kind);
          const n = group.findIndex((s) => s.key === step.key) + 1;
          return step.kind === 'column'
            ? t('gridEditor.step.moved', { label: labelOf(step), n, total: group.length })
            : t('gridEditor.banner.moved', { label: labelOf(step), n, total: group.length });
        }
        return resizeAnnounce(step.key)(next);
      };
      if (apply(a, si, message) && step) refocusStep(step);
    } else if (res.noop && step) {
      speak(noopText(res.noop, labelOf(step)));
    }
    return true;
  };

  const commitSpan = (a: { sectionKey: string; stepKey: string; span: Span }) => {
    const f = find(a.sectionKey, a.stepKey);
    if (f) spanTo(f.si, f.idx, f.step, a.span);
  };

  const slide = (sectionKey: string, stepKey: string, edge: Edge, span: Span) => {
    const f = find(sectionKey, stepKey);
    if (f) spanTo(f.si, f.idx, f.step, span, byAttr(root, 'data-ge-handle', `${stepKey}:${edge}`));
  };

  /** Enter / Space on a column step cell: focus moves to the panel heading (UX spec 14.2). */
  const activateStep = (stepKey: string) =>
    focusLater(
      () =>
        root.current?.querySelector<HTMLElement>(
          `[data-ge-panel="${CSS.escape(stepKey)}"] .ge-h4`,
        ) ?? null,
    );

  const activateBanner = (target: RovingTarget) => {
    if (target.kind !== 'banner') return;
    dispatch({ type: 'select', stepKey: target.key });
    focusLater(labelFinder(target.key));
  };

  // ---- panel api ------------------------------------------------------------------------

  const panelApi = (si: number, idx: number): StepPanelApi => {
    const step = d.sections[si]?.steps[idx];
    const label = step ? labelOf(step) : '';
    return {
      edit: (patch, field) =>
        step &&
        dispatch({
          type: 'stepEdit',
          section: si,
          step: idx,
          patch,
          groupKey: `${step.key}:${field}`,
        }),
      resize: (type: ResizeType) => {
        if (!step) return;
        const res = apply({ type, section: si, step: idx }, si, resizeAnnounce(step.key));
        if (!res) {
          const a = step.row_start ?? 0;
          const b = step.row_end ?? 0;
          const reason: NoopReason =
            type === 'stepGrowStart'
              ? 'startAtFirst'
              : type === 'stepGrowEnd'
                ? 'endAtLast'
                : 'minOneRow';
          speak(
            noopText(
              a === b && reason !== 'startAtFirst' && reason !== 'endAtLast' ? 'minOneRow' : reason,
              label,
            ),
          );
        }
      },
      move: (dir) => {
        if (!step) return;
        const to = idx + dir;
        const kind = d.sections[si].steps[to]?.kind;
        if (kind !== step.kind) {
          speak(noopText('columnEdge', label));
          return;
        }
        const res = apply({ type: 'stepMove', section: si, step: idx, to }, si, (next) => {
          const group = next.steps.filter((s) => s.kind === step.kind);
          const n = group.findIndex((s) => s.key === step.key) + 1;
          return step.kind === 'column'
            ? t('gridEditor.step.moved', { label, n, total: group.length })
            : t('gridEditor.banner.moved', { label, n, total: group.length });
        });
        if (res) focusLater(byAttr(root, 'data-ge-panel', step.key));
      },
      convert: (to?: StepKind) => {
        if (!step) return;
        const res = apply({ type: 'stepConvert', section: si, step: idx, to }, si, (next) => {
          const s = next.steps.find((x) => x.key === step.key);
          if (!s) return null;
          if (s.kind === 'column') {
            const n = next.steps
              .filter((x) => x.kind === 'column')
              .findIndex((x) => x.key === s.key);
            return t('gridEditor.step.convertedStep', {
              label,
              n: n + 1,
              rows: rowsText(s.row_start ?? 0, s.row_end ?? 0),
            });
          }
          return t('gridEditor.step.convertedBanner', {
            label,
            where: s.kind === 'banner_top' ? 'top' : 'bottom',
          });
        });
        if (res) focusLater(labelFinder(step.key));
      },
      remove: () => remove(si, idx),
    };
  };

  return {
    canAddStep: (si: number) => canAddStep(editor, si),
    canAddColumn: (si: number) => canAddColumnStep(editor, si),
    addStep,
    addBanner,
    chord,
    activateBanner,
    activateStep,
    commitSpan,
    slide,
    panelApi,
  };
}
