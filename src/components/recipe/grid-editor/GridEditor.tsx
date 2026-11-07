'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  canRedo,
  canUndo,
  doc,
  isDirty,
  issuesFor,
  uncoveredRows,
  type EditorIssue,
  type EditorSection,
} from '@/lib/grid/editor';
import { btn, btnPrimary } from '../styles';
import type { ApiRecipe } from '../types';
import { createAnnouncer, type Announcer } from './announcer';
import { GridEditorTable } from './GridEditorTable';
import { KeyboardHelp } from './KeyboardHelp';
import { IssuesPanel } from './IssuesPanel';
import { initSession, reduceSession, type ActionLabel } from './session';
import { announceText, historyText } from './text';
import { bannerId, rowId, stepId } from './roving';
import { SectionHeader } from './SectionHeader';
import { useFocusLater } from './useFocusLater';
import { useRowActions } from './useRowActions';
import { useSectionActions } from './useSectionActions';
import { useStepWiring } from './useStepWiring';
import { useUndoToast } from './useUndoToast';
import { ConflictPanel, KeptNote, ListNotice, NetworkAlert } from './SavePanels';
import { useSaveFlow } from './useSaveFlow';
import { useLeaveGuard } from './useLeaveGuard';

export type GridEditorProps = {
  recipe: ApiRecipe;
  /** Done (clean) or a confirmed Cancel. The page returns to the read view. */
  onClose: () => void;
  /** A successful save or "Load the latest": the page replaces its recipe data (G4). */
  onRecipe?: (recipe: ApiRecipe) => void;
};

const gapNames = (s: EditorSection) =>
  uncoveredRows(s.steps, s.ingredients.length).map((r) => s.ingredients[r].name || '...');

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.matches('input, textarea, select') || el.isContentEditable === true);

/**
 * The editor shell: reducer wiring, sticky toolbar, status region, issues and one edit-mode
 * table per section. Ingredient rows (T5), steps (T6), sections (T7), the phone sheet (T8)
 * and the save flow (T9) plug into the SEAM markers below.
 */
export function GridEditor({ recipe, onClose, onRecipe }: GridEditorProps) {
  const t = useTranslations();
  const [session, dispatch] = useReducer(reduceSession, recipe, initSession);
  const { editor } = session;
  const d = doc(editor);
  const issues = useMemo(() => issuesFor(d), [d]);
  const dirty = isDirty(editor);
  const undoable = canUndo(editor);
  const redoable = canRedo(editor);
  const multiple = d.sections.length > 1;

  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const issuesHeading = useRef<HTMLHeadingElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // F2: browser Back, Android back and the iOS edge swipe ask first while there are edits.
  useLeaveGuard(dirty, () => setConfirmingLeave(true));

  // One polite region for the whole editor; messages replace each other within 400 ms.
  const [live, setLive] = useState('');
  const announcer = useRef<Announcer | null>(null);
  useEffect(() => {
    const a = createAnnouncer(setLive);
    announcer.current = a;
    return () => {
      a.dispose();
      announcer.current = null;
    };
  }, []);
  const say = useCallback((m: string) => announcer.current?.announce(m), []);

  // T5/T7: row and section behaviour. `announce` also leaves the message in `lead`, so the
  // uncovered-rows sentence the session adds a moment later is appended, not replacing it.
  const lead = useRef<string | null>(null);
  const announce = useCallback(
    (m: string) => {
      lead.current = m;
      setTimeout(() => {
        if (lead.current === m) lead.current = null;
      }, 450);
      say(m);
    },
    [say],
  );
  const focusLater = useFocusLater();
  const { showToast, toastNode } = useUndoToast(d);
  const rows = useRowActions({
    editor,
    lastLabel: session.labels.past.at(-1) ?? null,
    dispatch,
    announce,
    root,
    focusLater,
    showToast,
    t,
  });
  const sections = useSectionActions({
    editor,
    dispatch,
    announce,
    root,
    focusLater,
    showToast,
    t,
  });

  const stepUi = useStepWiring({
    editor,
    dispatch,
    announce,
    focusLater,
    root,
    showToast,
    issues: [...issues.errors, ...issues.warnings],
  });

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmingLeave) keepButton.current?.focus();
  }, [confirmingLeave]);

  // Translate the session's structured announcement once per action.
  const lastSeq = useRef(0);
  useEffect(() => {
    const a = session.announcement;
    if (!a || a.seq === lastSeq.current) return;
    lastSeq.current = a.seq;
    const own = lead.current;
    lead.current = null;
    say([own, ...a.parts.map((p) => announceText(t, p))].filter(Boolean).join(' '));
  }, [session.announcement, say, t]);

  // T9: save flow. Outcomes are announced through the single status region.
  const sayOutcome = useCallback(
    (arg: string, kind: 'saving' | 'saved' | 'savedList' | 'rejected' | 'loaded' | 'failed') => {
      const key: Record<typeof kind, string> = {
        saving: 'gridEditor.announce.saving',
        saved: 'gridEditor.announce.saved',
        savedList: 'gridEditor.announce.savedList',
        rejected: 'gridEditor.announce.rejected',
        loaded: 'gridEditor.conflict.loaded',
        failed: 'gridEditor.save.failedShort',
      };
      say(t(key[kind], { count: Number(arg) || 0 }));
    },
    [say, t],
  );
  const flow = useSaveFlow({
    recipeId: recipe.id,
    initialBase: recipe.updated_at,
    editor,
    dispatch,
    onRecipe,
    say: sayOutcome,
  });
  useEffect(() => {
    if (flow.focusTick.n > 0 && flow.focusTick.what === 'issues') issuesHeading.current?.focus();
  }, [flow.focusTick]);

  const shownErrors = useMemo(() => {
    const seen = new Set(issues.errors.map((e) => `${e.path}|${e.code}`));
    return [...issues.errors, ...flow.rejected.filter((e) => !seen.has(`${e.path}|${e.code}`))];
  }, [issues.errors, flow.rejected]);
  const hasColumn = d.sections.some((s) => s.steps.some((st) => st.kind === 'column'));
  const addStepSection = d.sections.findIndex((s) => s.ingredients.length > 0);
  const addFirstStep = () => {
    if (addStepSection < 0) return;
    dispatch({
      type: 'stepAdd',
      section: addStepSection,
      step: { label: t('gridEditor.step.newLabel') },
    });
    announce(t('gridEditor.save.stepAddedForList'));
  };

  const errorCount = issues.errors.length;
  const warningCount = issues.warnings.length;
  const saveReason: string | null =
    errorCount > 0
      ? t('gridEditor.toolbar.saveDisabledErrors', { count: errorCount })
      : !dirty
        ? t('gridEditor.toolbar.saveDisabledClean')
        : null;

  const trySave = () => {
    if (saveReason) {
      say(saveReason);
      return;
    }
    if (flow.saving) return;
    void flow.save();
  };

  const findIn = (selector: string, match: (el: HTMLElement) => boolean) =>
    Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? []).find(match) ?? null;
  const focusTarget = (id: string) =>
    findIn('[data-ge-target]', (el) => el.dataset.geTarget === id)?.focus();

  const jumpSection = (from: number, dir: 1 | -1) => {
    const next = d.sections[from + dir];
    if (!next) return;
    findIn(
      `[data-ge-section] [data-ge-target][tabindex="0"]`,
      (el) => el.closest<HTMLElement>('[data-ge-section]')?.dataset.geSection === next.key,
    )?.focus();
  };

  const goTo = (issue: EditorIssue) => {
    const tg = issue.target;
    if (!tg) return;
    if (tg.stepKey) {
      const sec = d.sections.find((s) => s.key === tg.sectionKey);
      const kind = sec?.steps.find((s) => s.key === tg.stepKey)?.kind;
      focusTarget(kind === 'column' ? stepId(tg.stepKey) : bannerId(tg.stepKey));
    } else if (tg.rowKey) focusTarget(rowId(tg.rowKey));
    else findIn('[data-ge-heading]', (el) => el.dataset.geHeading === tg.sectionKey)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      trySave();
      return;
    }
    // Inside a text field the browser's own undo wins (T4 acceptance).
    if (isTextField(e.target)) return;
    if (k === 'z') {
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
    } else if (k === 'y' && e.ctrlKey) {
      e.preventDefault();
      dispatch({ type: 'redo' });
    }
  };

  const actionName = (labels: (ActionLabel | null)[]) => {
    const last = labels[labels.length - 1];
    return last ? historyText(t, last) : null;
  };
  const undoName = actionName(session.labels.past);
  const redoName = actionName(session.labels.future);
  const undoLabel =
    undoable && undoName ? t('gridEditor.toolbar.undoWith', { action: undoName }) : null;
  const redoLabel =
    redoable && redoName ? t('gridEditor.toolbar.redoWith', { action: redoName }) : null;

  const countText = [
    shownErrors.length > 0 ? t('gridEditor.toolbar.problems', { count: shownErrors.length }) : null,
    warningCount > 0 ? t('gridEditor.toolbar.warnings', { count: warningCount }) : null,
  ]
    .filter(Boolean)
    .join(', ');

  const saveReasonId = 'ge-save-reason';
  // F8: after a save the next step is Done, so it becomes the primary button.
  const savedClean = !dirty && session.saved;

  return (
    <div ref={root} className="ge-root" onKeyDown={onKeyDown}>
      <h2 ref={heading} tabIndex={-1} className="ge-h2">
        {t('gridEditor.heading')}
      </h2>
      <p className="ge-muted">{t('gridEditor.scope')}</p>
      <p className="ge-muted">{t('gridEditor.asWritten')}</p>

      {/* The only live region in edit mode (UX spec 15). Empty at mount. */}
      <div role="status" aria-atomic="true" className="sr-only">
        {live}
      </div>

      <div className="ge-toolbar" role="group" aria-label={t('gridEditor.toolbar.label')}>
        <div className="ge-toolbar-row">
          <button
            type="button"
            className={`${btn} aria-disabled:opacity-50`}
            aria-disabled={!undoable}
            aria-label={undoLabel ?? undefined}
            title={undoLabel ?? undefined}
            onClick={() => dispatch({ type: 'undo' })}
          >
            {t('gridEditor.toolbar.undo')}
          </button>
          <button
            type="button"
            className={`${btn} aria-disabled:opacity-50`}
            aria-disabled={!redoable}
            aria-label={redoLabel ?? undefined}
            title={redoLabel ?? undefined}
            onClick={() => dispatch({ type: 'redo' })}
          >
            {t('gridEditor.toolbar.redo')}
          </button>
          <span className="ge-dirty" data-dirty={dirty}>
            {dirty ? (
              <>
                <span aria-hidden="true" className="ge-dot" /> {t('gridEditor.toolbar.dirty')}
              </>
            ) : session.saved ? (
              <>
                <span aria-hidden="true" className="ge-check">
                  &#10003;
                </span>{' '}
                {t('gridEditor.toolbar.clean')}
              </>
            ) : null}
          </span>
        </div>
        <div className="ge-toolbar-row ge-toolbar-end">
          {countText && (
            <button
              type="button"
              className="ge-linkbtn"
              onClick={() => issuesHeading.current?.focus()}
            >
              {countText}
            </button>
          )}
          {confirmingLeave ? (
            <div
              role="group"
              aria-label={t('gridEditor.leave.confirm')}
              className="ge-confirm"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setConfirmingLeave(false);
                }
              }}
            >
              <span>{t('gridEditor.leave.confirm')}</span>
              <button
                ref={keepButton}
                type="button"
                className={btn}
                onClick={() => setConfirmingLeave(false)}
              >
                {t('gridEditor.leave.keep')}
              </button>
              <button type="button" className={btn} onClick={onClose}>
                {t('gridEditor.leave.discard')}
              </button>
            </div>
          ) : (
            <>
              {/* Done when clean, Cancel when dirty: one slot (UX spec F2, section 13). */}
              <button
                type="button"
                className={savedClean ? btnPrimary : btn}
                onClick={() => (dirty ? setConfirmingLeave(true) : onClose())}
              >
                {dirty ? t('gridEditor.toolbar.cancel') : t('gridEditor.toolbar.done')}
              </button>
              <button
                type="button"
                className={`${savedClean ? btn : btnPrimary} aria-disabled:opacity-60`}
                aria-disabled={saveReason !== null || flow.saving}
                aria-busy={flow.saving || undefined}
                aria-describedby={saveReason ? saveReasonId : undefined}
                onClick={trySave}
              >
                {flow.saving ? t('gridEditor.toolbar.saving') : t('gridEditor.toolbar.save')}
              </button>
              {saveReason && (
                <span id={saveReasonId} className="sr-only">
                  {saveReason}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <KeyboardHelp />

      {flow.phase === 'network' && (
        <NetworkAlert focusKey={flow.focusTick.n} onRetry={() => void flow.save()} />
      )}
      {flow.kept && flow.phase === 'idle' && <KeptNote />}
      {toastNode}
      {stepUi.tooltip}

      <div className="ge-sections">
        {d.sections.map((section, si) => {
          const title = section.title?.trim() || t('recipe.section', { n: si + 1 });
          const name = section.title?.trim() || (multiple ? title : recipe.title);
          return (
            <section
              key={section.key}
              data-ge-section={section.key}
              aria-labelledby={`ge-sec-${si}`}
              className="ge-section"
            >
              <SectionHeader
                index={si}
                sectionKey={section.key}
                title={title}
                rawTitle={section.title}
                multiple={multiple}
                rowCount={section.ingredients.length}
                stepCount={section.steps.length}
                atRowCap={rows.capMessage(si) !== null}
                capMessage={rows.capMessage(si)}
                promptRename={sections.promptFor(si)}
                onRename={(v) => sections.rename(si, v)}
                announce={announce}
                onDelete={() => sections.remove(si)}
                onAddRow={() => rows.addRow(si)}
                extraActions={stepUi.toolbar(si)}
                // SEAM T7 stretch: Move up / down.
              />
              <GridEditorTable
                section={section}
                name={name}
                selectedStepKey={editor.selection.stepKey}
                onSelectStep={(stepKey) => dispatch({ type: 'select', stepKey })}
                onSectionJump={(dir) => jumpSection(si, dir)}
                {...stepUi.tableProps(si, (e, target) => rows.onRowKey(si, e, target))}
                onActivateRow={rows.activate}
                renderRowEditor={(r, previewId) => rows.renderEditor(si, r, previewId)}
                renderRowControls={(r) => rows.renderControls(si, r)}
              />
              {stepUi.panel(si)}
              {gapNames(section).length > 0 && (
                <p className="ge-warnline">
                  <span aria-hidden="true">!</span>{' '}
                  {t('gridEditor.issue.row_uncovered', { names: gapNames(section).join(', ') })}
                </p>
              )}
              {/* SEAM T8: phone (< 640 px) bottom sheet reuses StepPanel's Adjust rows block. */}
            </section>
          );
        })}
        {sections.renderAdd()}
      </div>

      {!hasColumn && <ListNotice onAddStep={addStepSection >= 0 ? addFirstStep : null} />}
      {flow.phase === 'conflict' && (
        <ConflictPanel
          confirm={flow.confirm}
          stamp={flow.conflictStamp}
          focusKey={flow.focusTick.n}
          onConfirm={flow.setConfirm}
          onKeep={flow.keepEditing}
          onLoad={() => void flow.loadLatest()}
          onSaveMine={() => void flow.saveMine()}
        />
      )}
      {/* F17: also shown during a conflict, so the toolbar's problem count has a target. */}
      <IssuesPanel
        doc={d}
        errors={shownErrors}
        warnings={issues.warnings}
        headingRef={issuesHeading}
        onGoTo={goTo}
      />
    </div>
  );
}
