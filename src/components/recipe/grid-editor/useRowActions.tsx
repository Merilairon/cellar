'use client';

import { useCallback, useState, type Dispatch, type RefObject } from 'react';
import { LIMITS } from '@/lib/grid/editor';
import {
  canAddRow,
  doc,
  newKey,
  reduce,
  type EditorAction,
  type EditorState,
} from '@/lib/grid/editor';
import type { ActionLabel } from './session';
import { IngredientRowEditor, PortionLabelInput, type RowEditEnd } from './IngredientRowEditor';
import { RowControls, type RowActionId } from './RowControls';
import { portionOf, parseRowText, rowLine } from './ingredient-text';
import { byAttr, byTarget } from './useFocusLater';
import { rowId, type RovingTarget } from './roving';
import type { T } from './text';

export type RowActionsDeps = {
  editor: EditorState;
  /** The label of the latest history entry (to tell a just-added row from older work). */
  lastLabel: ActionLabel | null;
  dispatch: Dispatch<EditorAction>;
  /** Announce in the editor's single polite region. */
  announce: (message: string) => void;
  root: RefObject<HTMLElement | null>;
  focusLater: (finder: () => HTMLElement | null) => void;
  showToast: (message: string, onUndo: () => void) => void;
  t: T;
};

type Editing = { key: string; isNew: boolean };

/**
 * Ingredient row behaviour for the editor (T5): inline text edit, move, add, delete, split and
 * portion labels. Returns the props GridEditorTable needs plus the chord handler. Every change
 * is one reducer action; nothing here keeps document state.
 */
export function useRowActions(deps: RowActionsDeps) {
  const { editor, lastLabel, dispatch, announce, root, focusLater, showToast, t } = deps;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [portionKey, setPortionKey] = useState<string | null>(null);
  const d = doc(editor);

  const focusRow = useCallback(
    (key: string) => focusLater(byTarget(root, rowId(key))),
    [focusLater, root],
  );

  const limitMessage = () => t('gridEditor.limit.ingredients', { max: LIMITS.ingredients });

  const moveRow = (si: number, r: number, dir: -1 | 1, viaButton = false) => {
    const sec = d.sections[si];
    const ing = sec?.ingredients[r];
    if (!sec || !ing) return;
    const name = ing.name || '...';
    const to = r + dir;
    if (to < 0) return announce(t('gridEditor.row.first', { name }));
    if (to >= sec.ingredients.length) return announce(t('gridEditor.row.lastRow', { name }));
    dispatch({ type: 'rowMove', section: si, from: r, to });
    announce(t('gridEditor.row.moved', { name, n: to + 1, total: sec.ingredients.length }));
    if (viaButton) {
      const act = dir < 0 ? 'moveUp' : 'moveDown';
      focusLater(
        () =>
          root.current?.querySelector<HTMLElement>(
            `[data-ge-rowkey="${ing.key}"] [data-ge-act="${act}"]`,
          ) ?? null,
      );
    } else focusRow(ing.key);
  };

  const addRow = (si: number, afterIndex?: number) => {
    if (!canAddRow(editor, si)) return announce(limitMessage());
    const n = d.sections[si]?.ingredients.length ?? 0;
    dispatch({ type: 'rowAdd', section: si, at: afterIndex === undefined ? n : afterIndex + 1 });
    setEditing({ key: newKey(editor.nextKey), isNew: true });
    announce(t('gridEditor.row.added'));
  };

  const deleteRow = (si: number, r: number) => {
    const sec = d.sections[si];
    const ing = sec?.ingredients[r];
    if (!sec || !ing) return;
    const action: EditorAction = { type: 'rowDelete', section: si, row: r };
    const probe = reduce(editor, action);
    const name = ing.name || '...';
    const steps = probe.notice?.type === 'stepsRemoved' ? probe.notice.labels : [];
    const message = steps.length
      ? t('gridEditor.row.deletedWithStep', { count: steps.length, name, steps: steps.join(', ') })
      : t('gridEditor.row.deleted', { name });
    dispatch(action);
    const next = sec.ingredients[r + 1] ?? sec.ingredients[r - 1];
    focusLater(next ? byTarget(root, rowId(next.key)) : byAttr(root, 'data-ge-heading', sec.key));
    announce(`${message} ${t('gridEditor.toast.available')}`);
    showToast(message, () => {
      dispatch({ type: 'undo' });
      focusRow(ing.key);
    });
  };

  const splitRow = (si: number, r: number) => {
    if (!canAddRow(editor, si)) return announce(limitMessage());
    const action: EditorAction = { type: 'rowSplit', section: si, row: r };
    const probe = reduce(editor, action);
    const rows = doc(probe).sections[si]?.ingredients;
    if (probe === editor || !rows) return;
    announce(
      t('gridEditor.row.splitDone', {
        name: rows[r].name || '...',
        first: rows[r].portion_label ?? '',
        second: rows[r + 1].portion_label ?? '',
      }),
    );
    dispatch(action);
    setPortionKey(rows[r + 1].key);
  };

  const finishEdit = (si: number, r: number, end: RowEditEnd) => {
    const cur = editing;
    setEditing(null);
    const sec = d.sections[si];
    const ing = sec?.ingredients[r];
    if (!cur || !ing) return;
    const removeNew = () => {
      if (lastLabel === 'rowAdd') dispatch({ type: 'undo' });
      else dispatch({ type: 'rowDelete', section: si, row: r });
      const next = sec.ingredients[r - 1] ?? sec.ingredients[r + 1];
      if (next) focusRow(next.key);
    };
    const backToRow = (viaBlur: boolean) => {
      if (!viaBlur) focusRow(ing.key);
    };
    if (end.type === 'cancel') {
      if (cur.isNew) removeNew();
      else focusRow(ing.key);
      return;
    }
    const parsed = parseRowText(end.text);
    if (!parsed.ok) {
      if (cur.isNew) return removeNew();
      announce(t('gridEditor.row.needsName')); // keeps the old text; never a nameless row
      return backToRow(end.viaBlur);
    }
    if (cur.isNew || end.text.trim() !== rowLine(ing).trim()) {
      dispatch({ type: 'rowEditText', section: si, row: r, patch: parsed.patch });
    }
    if (end.addBelow) {
      // The reducer applies the edit first; the new row goes right below it.
      dispatch({ type: 'rowAdd', section: si, at: r + 1 });
      setEditing({ key: newKey(editor.nextKey), isNew: true });
      announce(t('gridEditor.row.added'));
      return;
    }
    backToRow(end.viaBlur);
  };

  const finishPortion = (
    si: number,
    r: number,
    end: { type: 'commit'; text: string; viaBlur: boolean } | { type: 'cancel' },
  ) => {
    setPortionKey(null);
    const ing = d.sections[si]?.ingredients[r];
    if (!ing) return;
    if (end.type === 'commit') {
      dispatch({
        type: 'rowEditField',
        section: si,
        row: r,
        field: 'portion_label',
        value: end.text,
      });
      if (end.viaBlur) return;
    }
    focusRow(ing.key);
  };

  const onAction = (si: number, r: number, id: RowActionId, viaButton = false) => {
    const ing = d.sections[si]?.ingredients[r];
    if (!ing) return;
    if (id === 'edit') setEditing({ key: ing.key, isNew: false });
    else if (id === 'moveUp') moveRow(si, r, -1, viaButton);
    else if (id === 'moveDown') moveRow(si, r, 1, viaButton);
    else if (id === 'addBelow') addRow(si, r);
    else if (id === 'split') splitRow(si, r);
    else if (id === 'renamePortion') setPortionKey(ing.key);
    else deleteRow(si, r);
  };

  /** Chords and keys on an ingredient row target. Returns true when handled. */
  const onRowKey = (si: number, e: React.KeyboardEvent, target: RovingTarget): boolean => {
    if (target.kind !== 'row') return false;
    const r = target.index;
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
      e.preventDefault();
      moveRow(si, r, e.key === 'ArrowUp' ? -1 : 1);
      return true;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteRow(si, r);
      return true;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      setEditing({ key: target.key, isNew: false });
      return true;
    }
    return false;
  };

  const activate = (target: RovingTarget) => {
    if (target.kind === 'row') setEditing({ key: target.key, isNew: false });
  };

  /** The inline editor that replaces a row's button, or null. */
  const renderEditor = (si: number, r: number, previewId: string) => {
    const ing = d.sections[si]?.ingredients[r];
    if (!ing || editing?.key !== ing.key) return null;
    return (
      <IngredientRowEditor
        n={r + 1}
        initial={ing.name ? rowLine(ing) : ''}
        previewId={previewId}
        onEnd={(end) => finishEdit(si, r, end)}
      />
    );
  };

  /** Chip, move buttons, Row actions menu and the portion label field of a row. */
  const renderControls = (si: number, r: number) => {
    const sec = d.sections[si];
    const ing = sec?.ingredients[r];
    if (!sec || !ing || editing?.key === ing.key) return null;
    const name = ing.name || '...';
    return (
      <>
        {portionKey === ing.key && (
          <PortionLabelInput
            name={name}
            initial={ing.portion_label ?? ''}
            onEnd={(end) => finishPortion(si, r, end)}
          />
        )}
        <RowControls
          name={name}
          rowKey={ing.key}
          portion={portionOf(sec.ingredients, r)}
          isFirst={r === 0}
          isLast={r === sec.ingredients.length - 1}
          atCap={sec.ingredients.length >= LIMITS.ingredients}
          onAction={(id, origin) => onAction(si, r, id, origin === 'inline')}
        />
      </>
    );
  };

  return {
    editingKey: editing?.key ?? null,
    addRow,
    onRowKey,
    activate,
    renderEditor,
    renderControls,
    capMessage: (si: number) =>
      (d.sections[si]?.ingredients.length ?? 0) >= LIMITS.ingredients ? limitMessage() : null,
  };
}

export type RowActions = ReturnType<typeof useRowActions>;
