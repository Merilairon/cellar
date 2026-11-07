'use client';

import type { Dispatch, RefObject } from 'react';
import { LIMITS } from '@/lib/grid/editor';
import {
  canAddSection,
  canDeleteSection,
  doc,
  type EditorAction,
  type EditorState,
} from '@/lib/grid/editor';
import { btn } from '../styles';
import { byAttr } from './useFocusLater';
import type { T } from './text';

export type SectionActionsDeps = {
  editor: EditorState;
  dispatch: Dispatch<EditorAction>;
  announce: (message: string) => void;
  root: RefObject<HTMLElement | null>;
  focusLater: (finder: () => HTMLElement | null) => void;
  showToast: (message: string, onUndo: () => void) => void;
  t: T;
};

/** Section add / rename / delete (T7). Reorder is a stretch and has no UI. */
export function useSectionActions(deps: SectionActionsDeps) {
  const { editor, dispatch, announce, root, focusLater, showToast, t } = deps;
  const d = doc(editor);

  const display = (si: number) =>
    d.sections[si]?.title?.trim() || t('recipe.section', { n: si + 1 });

  const rename = (si: number, title: string) => {
    if (!d.sections[si]) return;
    dispatch({ type: 'sectionRename', section: si, title: title || null });
    announce(
      t('gridEditor.section.renamed', { name: title || t('recipe.section', { n: si + 1 }) }),
    );
  };

  const remove = (si: number) => {
    const sec = d.sections[si];
    if (!sec || !canDeleteSection(editor)) return;
    const title = display(si);
    dispatch({ type: 'sectionDelete', section: si });
    const next = d.sections[si - 1] ?? d.sections[si + 1];
    focusLater(byAttr(root, 'data-ge-heading', next.key));
    const message = t('gridEditor.section.deleted', { title });
    announce(`${message} ${t('gridEditor.toast.available')}`);
    showToast(message, () => {
      dispatch({ type: 'undo' });
      focusLater(byAttr(root, 'data-ge-heading', sec.key));
    });
  };

  const add = () => {
    if (!canAddSection(editor))
      return announce(t('gridEditor.limit.sections', { max: LIMITS.sections }));
    const n = d.sections.length + 1;
    const title = t('recipe.section', { n });
    dispatch({ type: 'sectionAdd', title });
    announce(t('gridEditor.section.added', { name: title }));
    // The reducer appends with the next client key; focus its Add row button once rendered.
    focusLater(() => {
      const all = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-ge-addrow]') ?? []);
      return all.length > n - 1 ? all[n - 1] : null;
    });
  };

  /** The Add section button and its limit message, rendered below the last section. */
  const renderAdd = () => {
    const full = !canAddSection(editor);
    return (
      <div className="flex flex-col gap-1">
        <div>
          <button
            type="button"
            className={`${btn} aria-disabled:opacity-50`}
            aria-disabled={full ? true : undefined}
            aria-describedby={full ? 'ge-add-section-cap' : undefined}
            onClick={add}
          >
            {t('gridEditor.section.add')}
          </button>
        </div>
        {full && (
          <p id="ge-add-section-cap" className="ge-muted">
            {t('gridEditor.limit.sections', { max: LIMITS.sections })}
          </p>
        )}
      </div>
    );
  };

  return { rename, remove, add, renderAdd };
}
