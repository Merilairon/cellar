'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { uncoveredRows, type EditorIngredient, type EditorSection } from '@/lib/grid/editor';
import { buildSectionLayout } from '@/lib/grid/layout';
import { formatStepParams, type StepT } from '../formatStep';
import { IngredientCell } from '../IngredientCell';
import { OPEN_ROW_ACTIONS } from './RowControls';
import { ScrollRegion } from '../ScrollRegion';
import type { ApiIngredient } from '../types';
import {
  bannerId,
  defaultTarget,
  navigate,
  NAV_KEYS,
  rowId,
  stepId,
  targetsFor,
  type NavKey,
  type RovingTarget,
} from './roving';

export type TableTarget = RovingTarget;

export type GridEditorTableProps = {
  section: EditorSection;
  /** Visible heading text of the section, or the recipe title for a single untitled section. */
  name: string;
  selectedStepKey: string | null;
  onSelectStep: (key: string | null) => void;
  /** PageDown / PageUp: the parent focuses the neighbouring section's table. */
  onSectionJump: (dir: 1 | -1) => void;
  /**
   * A chord (Alt or Shift or Meta held) on a roving target. Row moves,
   * span resizing, step moves and deletes plug in here. Return true when handled.
   */
  onChord?: (e: React.KeyboardEvent, target: TableTarget) => boolean;
  /** Enter / Space / click on an ingredient row (inline text edit). */
  onActivateRow?: (target: TableTarget) => void;
  /**
   * T5: the inline text editor that replaces row `r`'s button (null when not editing) and the
   * per-row controls (portion chip, Move, Row actions) rendered after it.
   */
  renderRowEditor?: (r: number, previewId: string) => React.ReactNode;
  renderRowControls?: (r: number) => React.ReactNode;
  /** Enter / Space / click on a banner (banner panel). */
  onActivateBanner?: (target: TableTarget) => void;
  /** Keyboard activation (Enter / Space) of a column step cell that is not selected yet. */
  onActivateStep?: (stepKey: string) => void;
  /** T6: span handles (and anything else) rendered inside a column step's cell. */
  renderStepExtras?: (info: {
    step: EditorSection['steps'][number];
    rowStart: number;
    rowEnd: number;
  }) => React.ReactNode;
  /** T6: while a handle is dragged, the proposed span drives the live highlight. */
  previewSpan?: { stepKey: string; start: number; end: number } | null;
};

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.matches('input, textarea, select') || el.isContentEditable === true);

/** Display model for IngredientCell: the stored primary measure, no scaling (F3). */
export function toCellIngredient(i: EditorIngredient, position: number): ApiIngredient {
  return {
    id: i.key,
    position,
    name: i.name,
    note: i.note,
    raw_text: i.raw_text ?? i.name,
    metric_qty: i.metric_qty,
    metric_qty_max: i.metric_qty_max,
    metric_unit: i.metric_unit,
    us_qty: i.us_qty,
    us_qty_max: i.us_qty_max,
    us_unit: i.us_unit,
    display_primary: i.display_primary,
    split_group_id: i.split_group,
    portion_label: i.portion_label,
    group_label: i.group_label,
  };
}

/**
 * Edit-mode table for one section: a real table with the read view's structure (same
 * `buildSectionLayout`, classes, scope attributes and caption) plus one roving tab stop.
 * Props in, markup out; all edits go through the parent's reducer (G10).
 */
export function GridEditorTable({
  section,
  name,
  selectedStepKey,
  onSelectStep,
  onSectionJump,
  onChord,
  onActivateRow,
  renderRowEditor,
  renderRowControls,
  onActivateBanner,
  onActivateStep,
  renderStepExtras,
  previewSpan,
}: GridEditorTableProps) {
  const t = useTranslations();
  const stepT: StepT = (key, values) => t(key, values);
  const [remembered, setRemembered] = useState<string | null>(null);

  const rows = section.ingredients;
  const layout = buildSectionLayout(rows.length, section.steps);
  const targets = targetsFor(section);
  const active = targets.some((x) => x.id === remembered) ? remembered : defaultTarget(targets);
  const uncovered = new Set(uncoveredRows(section.steps, rows.length));
  const selected = layout.columns.find((c) => c.step.key === selectedStepKey) ?? null;
  const colSpan = layout.columns.length + 1;
  const tab = (id: string) => (id === active ? 0 : -1);
  const targetOf = (id: string) => targets.find((x) => x.id === id);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ge-target]');
    if (!el || isTextField(e.target) || e.nativeEvent.isComposing) return;
    const target = targetOf(el.dataset.geTarget ?? '');
    if (!target) return;
    // Shift+F10 / ContextMenu: Row actions for a row; select and open the panel for a step or
    // banner (the same as Enter). These buttons are not tab stops (A3).
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.altKey && !e.ctrlKey)) {
      e.preventDefault();
      if (target.kind === 'row')
        e.currentTarget
          .querySelector(`[data-ge-rowkey="${CSS.escape(target.key)}"]`)
          ?.dispatchEvent(new CustomEvent(OPEN_ROW_ACTIONS));
      else if (target.kind === 'banner') onActivateBanner?.(target);
      else {
        if (selectedStepKey !== target.key) onSelectStep(target.key);
        onActivateStep?.(target.key);
      }
      return;
    }
    if (
      e.altKey ||
      e.shiftKey ||
      e.metaKey ||
      e.key === 'Delete' ||
      e.key === 'Backspace' ||
      e.key === 'F2'
    ) {
      onChord?.(e, target);
      return;
    }
    if (!NAV_KEYS.includes(e.key)) return;
    e.preventDefault();
    const res = navigate(targets, target.id, e.key as NavKey, e.ctrlKey);
    if (!res) return;
    if (res.type === 'section') {
      onSectionJump(res.dir);
      return;
    }
    setRemembered(res.id);
    const next = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-ge-target]')).find(
      (n) => n.dataset.geTarget === res.id,
    );
    next?.focus();
  };

  const banner = (s: EditorSection['steps'][number]) => {
    const params = formatStepParams(s, stepT);
    const id = bannerId(s.key);
    return (
      <tr key={s.key}>
        <td colSpan={colSpan} className="rg-banner">
          <div className="rg-bn">
            <button
              type="button"
              className="ge-target ge-bannerbtn"
              data-ge-target={id}
              tabIndex={tab(id)}
              onClick={() => {
                const tg = targetOf(id);
                if (tg) onActivateBanner?.(tg);
              }}
            >
              {s.detail || s.label || (
                <span className="ge-placeholder">{t('gridEditor.banner.empty')}</span>
              )}
              {params && <span className="rg-parinline"> {params}</span>}
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="ge-region">
      <ScrollRegion
        label={t('recipe.grid.region', { title: name })}
        stepCount={layout.columns.length}
        focusable={false}
      >
        <table
          className="rg-table ge-table"
          data-ge-table={section.key}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            const id = (e.target as HTMLElement).closest<HTMLElement>('[data-ge-target]')?.dataset
              .geTarget;
            if (id && id !== remembered) setRemembered(id);
          }}
        >
          <caption className="sr-only">{t('recipe.grid.caption', { title: name })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('recipe.grid.ingredientsHeader')}</th>
              {layout.columns.map((c) => (
                <th key={c.step.key} scope="col">
                  {t('recipe.grid.stepHeader', { n: c.columnIndex + 1, label: c.step.label })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layout.bannersTop.map(banner)}
            {rows.map((ing, r) => {
              const id = rowId(ing.key);
              const range = previewSpan
                ? { s: previewSpan.start, e: previewSpan.end }
                : selected
                  ? { s: selected.rowStart, e: selected.rowEnd }
                  : null;
              const covered = !!range && range.s <= r && r <= range.e;
              const gap = uncovered.has(r);
              return (
                <tr key={ing.key}>
                  <th
                    scope="row"
                    className="rg-ing ge-ing"
                    data-covered={covered || undefined}
                    data-uncovered={gap || undefined}
                  >
                    {(() => {
                      const editorNode = renderRowEditor?.(r, `ge-prev-${ing.key}`);
                      if (editorNode) return editorNode;
                      return (
                        <div className="ge-rowcell flex items-center">
                          <button
                            type="button"
                            className="ge-target ge-rowbtn min-w-0 flex-1"
                            data-ge-target={id}
                            tabIndex={tab(id)}
                            onClick={() => {
                              const tg = targetOf(id);
                              if (tg) onActivateRow?.(tg);
                            }}
                          >
                            <span className="sr-only">
                              {t('gridEditor.row.prefix', { n: r + 1, total: rows.length })}
                            </span>
                            <IngredientCell ingredient={toCellIngredient(ing, r)} />
                            {gap && (
                              <>
                                <span className="ge-bang" aria-hidden="true">
                                  !
                                </span>
                                <span className="sr-only"> {t('gridEditor.row.uncovered')}</span>
                              </>
                            )}
                          </button>
                          {renderRowControls?.(r)}
                        </div>
                      );
                    })()}
                  </th>
                  {layout.rows[r].map((cell) => {
                    if (cell.type === 'empty')
                      return <td key={`e${cell.columnIndex}`} className="rg-empty" />;
                    const c = cell.column;
                    const step = c.step;
                    const sid = stepId(step.key);
                    const open = step.key === selectedStepKey;
                    const params = formatStepParams(step, stepT);
                    return (
                      <td
                        key={step.key}
                        rowSpan={c.rowSpan}
                        className="rg-step ge-step"
                        data-selected={open}
                        onClick={() => onSelectStep(open ? null : step.key)}
                      >
                        <button
                          type="button"
                          className="rg-stepbtn ge-target"
                          data-ge-target={sid}
                          data-step-key={step.key}
                          tabIndex={tab(sid)}
                          aria-pressed={open}
                          onClick={(e) => {
                            // detail 0 = keyboard activation; the cell's own onClick selects.
                            if (e.detail === 0 && !open) onActivateStep?.(step.key);
                          }}
                        >
                          <span className="sr-only">
                            {t('gridEditor.step.prefix', { n: c.columnIndex + 1 })}
                          </span>
                          <span className="rg-lbl">{step.label}</span>
                          {params && <span className="rg-par">{params}</span>}
                          <span className="sr-only">
                            {c.rowStart === c.rowEnd
                              ? t('recipe.grid.stepRow', { name: rows[c.rowStart]?.name ?? '' })
                              : t('recipe.grid.stepRows', {
                                  from: rows[c.rowStart]?.name ?? '',
                                  to: rows[c.rowEnd]?.name ?? '',
                                })}
                          </span>
                        </button>
                        {renderStepExtras?.({ step, rowStart: c.rowStart, rowEnd: c.rowEnd })}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {layout.bannersBottom.map(banner)}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
