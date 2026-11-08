'use client';

import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { doc, type EditorAction, type EditorIssue, type EditorState } from '@/lib/grid/editor';
import type { GridEditorTableProps, TableTarget } from './GridEditorTable';
import { StepHandles } from './StepHandles';
import { PHONE_QUERY, useMediaQuery } from '../useViewPreference';
import { StepPanel } from './StepPanel';
import { StepSheet } from './StepSheet';
import { byTarget } from './useFocusLater';
import { stepId } from './roving';
import { StepsToolbar } from './StepsToolbar';
import { useSpanDrag } from './useSpanDrag';
import { useStepEditing } from './useStepEditing';

type TableKeys =
  'onChord' | 'onActivateBanner' | 'onActivateStep' | 'renderStepExtras' | 'previewSpan';

type Params = {
  editor: EditorState;
  dispatch: (a: EditorAction) => void;
  announce: (m: string) => void;
  focusLater: (finder: () => HTMLElement | null) => void;
  root: RefObject<HTMLElement | null>;
  showToast: (message: string, onUndo: () => void) => void;
  issues: EditorIssue[];
};

/**
 * T6 wiring in one place so `GridEditor.tsx` only calls four functions: the section toolbar
 * buttons, the table props (chords, banner activation, span handles, drag preview), the step
 * panel under the table, and the drag tooltip.
 */
export function useStepWiring({
  editor,
  dispatch,
  announce,
  focusLater,
  root,
  showToast,
  issues,
}: Params) {
  const t = useTranslations();
  const d = doc(editor);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const steps = useStepEditing({ editor, dispatch, say: announce, focusLater, root, showToast });
  const drag = useSpanDrag({
    onSelect: (stepKey) => dispatch({ type: 'select', stepKey }),
    onCommit: steps.commitSpan,
  });

  const toolbar = (si: number) => (
    <StepsToolbar
      canAdd={steps.canAddStep(si)}
      canAddColumn={steps.canAddColumn(si)}
      onAddStep={() => steps.addStep(si)}
      onAddBanner={(kind) => steps.addBanner(si, kind)}
    />
  );

  const tableProps = (
    si: number,
    rowsChord: (e: React.KeyboardEvent, target: TableTarget) => boolean,
  ): Pick<GridEditorTableProps, TableKeys> => {
    const section = d.sections[si];
    const chord = steps.chord(si);
    return {
      onChord: (e, target) => chord(e, target) || rowsChord(e, target),
      onActivateBanner: steps.activateBanner,
      onActivateStep: steps.activateStep,
      previewSpan:
        drag.preview && drag.preview.sectionKey === section.key
          ? { stepKey: drag.preview.stepKey, start: drag.preview.start, end: drag.preview.end }
          : null,
      renderStepExtras: ({ step, rowStart, rowEnd }) => (
        <StepHandles
          label={step.label || t('gridEditor.step.newLabel')}
          stepKey={step.key}
          span={{ start: rowStart, end: rowEnd }}
          names={section.ingredients.map((i) => i.name)}
          onBegin={(e, edge) =>
            drag.begin(e, {
              sectionKey: section.key,
              stepKey: step.key,
              edge,
              origin: { start: rowStart, end: rowEnd },
              rows: section.ingredients.length,
            })
          }
          onSlide={(edge, span) => steps.slide(section.key, step.key, edge, span)}
        />
      ),
    };
  };

  /** The panel of the selected step or banner when it belongs to section `si`. */
  const panel = (si: number) => {
    const section = d.sections[si];
    const idx = section.steps.findIndex((s) => s.key === editor.selection.stepKey);
    if (idx < 0) return null;
    const step = section.steps[idx];
    const group = section.steps.filter((s) => s.kind === step.kind);
    const props = {
      section,
      step,
      position: group.indexOf(step),
      groupSize: group.length,
      issues,
      doc: d,
      api: steps.panelApi(si, idx),
    };
    // Phone: the same panel as a bottom sheet (T8). Closing hands focus back to the step cell.
    if (isPhone)
      return (
        <StepSheet
          key={step.key}
          {...props}
          onClose={() => {
            dispatch({ type: 'select', stepKey: null });
            focusLater(byTarget(root, stepId(step.key)));
          }}
        />
      );
    return <StepPanel key={step.key} {...props} />;
  };

  const tooltip =
    drag.preview && drag.pointer ? (
      <div
        aria-hidden="true"
        className="ge-dragtip"
        style={{ left: drag.pointer.x + 14, top: drag.pointer.y + 14 }}
      >
        {drag.preview.start === drag.preview.end
          ? t('gridEditor.step.dragRow', { from: drag.preview.start + 1 })
          : t('gridEditor.step.dragRows', {
              from: drag.preview.start + 1,
              to: drag.preview.end + 1,
            })}
      </div>
    ) : null;

  return { toolbar, tableProps, panel, tooltip };
}
