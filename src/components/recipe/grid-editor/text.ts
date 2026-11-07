// Message lookups with literal keys only (the i18n catalog test cannot check dynamic keys).

import type { ActionLabel, AnnouncePart } from './session';

type Values = Record<string, string | number>;
export type T = (key: string, values?: Values) => string;

export const historyText = (t: T, label: ActionLabel): string =>
  ({
    rowMove: t('gridEditor.history.rowMove'),
    rowAdd: t('gridEditor.history.rowAdd'),
    rowDelete: t('gridEditor.history.rowDelete'),
    rowSplit: t('gridEditor.history.rowSplit'),
    rowEdit: t('gridEditor.history.rowEdit'),
    stepAdd: t('gridEditor.history.stepAdd'),
    stepDelete: t('gridEditor.history.stepDelete'),
    stepMove: t('gridEditor.history.stepMove'),
    stepResize: t('gridEditor.history.stepResize'),
    stepConvert: t('gridEditor.history.stepConvert'),
    stepEdit: t('gridEditor.history.stepEdit'),
    bannerAdd: t('gridEditor.history.bannerAdd'),
    sectionAdd: t('gridEditor.history.sectionAdd'),
    sectionRename: t('gridEditor.history.sectionRename'),
    sectionDelete: t('gridEditor.history.sectionDelete'),
    sectionMove: t('gridEditor.history.sectionMove'),
  })[label];

export function announceText(t: T, p: AnnouncePart): string {
  if (p.id === 'undone' || p.id === 'redone') {
    const done = p.id === 'undone';
    if (!p.action)
      return done ? t('gridEditor.announce.undoneGeneric') : t('gridEditor.announce.redoneGeneric');
    const action = historyText(t, p.action);
    return done
      ? t('gridEditor.announce.undone', { action })
      : t('gridEditor.announce.redone', { action });
  }
  if (p.id === 'nothingToUndo') return t('gridEditor.announce.nothingToUndo');
  if (p.id === 'nothingToRedo') return t('gridEditor.announce.nothingToRedo');
  if (p.id === 'uncoveredNow') return t('gridEditor.announce.uncoveredNow', { names: p.names });
  return t('gridEditor.announce.allCovered');
}

export function issueMessage(t: T, key: string, v: Values): string {
  const map: Record<string, () => string> = {
    row_uncovered: () => t('gridEditor.issue.row_uncovered', v),
    positions_not_contiguous: () => t('gridEditor.issue.positions_not_contiguous'),
    banner_has_span: () => t('gridEditor.issue.banner_has_span'),
    span_required_for_grid: () => t('gridEditor.issue.span_required_for_grid', v),
    span_incomplete: () => t('gridEditor.issue.span_incomplete', v),
    row_order: () => t('gridEditor.issue.row_order', v),
    row_out_of_range: () => t('gridEditor.issue.row_out_of_range', v),
    no_rows: () => t('gridEditor.issue.no_rows', v),
    split_group_cross_section: () => t('gridEditor.issue.split_group_cross_section'),
    empty_section: () => t('gridEditor.issue.empty_section', v),
    name_empty: () => t('gridEditor.issue.name_empty'),
    label_empty: () => t('gridEditor.issue.label_empty'),
    banner_empty: () => t('gridEditor.issue.banner_empty'),
  };
  return (map[key] ?? (() => t('gridEditor.issue.unknown', v)))();
}
