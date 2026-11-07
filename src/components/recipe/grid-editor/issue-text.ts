// Maps a validator or schema issue to a message key and values (UX spec 11). Pure; the panel
// translates `key` under `gridEditor.issue.*`.

import { parseIssuePath, type EditorDoc, type EditorIssue } from '@/lib/grid/editor';

const STEP_CODES = new Set([
  'banner_has_span',
  'span_required_for_grid',
  'span_incomplete',
  'row_order',
  'row_out_of_range',
  'no_rows',
]);
const KNOWN = new Set([
  ...STEP_CODES,
  'row_uncovered',
  'positions_not_contiguous',
  'split_group_cross_section',
  'name_empty',
  'label_empty',
  'banner_empty',
]);

export type IssueText = { key: string; values: Record<string, string | number> };

export function issueText(d: EditorDoc, issue: EditorIssue): IssueText {
  const p = parseIssuePath(issue.path);
  const sec = p ? d.sections[p.section] : undefined;
  const step = p?.kind === 'step' && sec ? sec.steps[p.index ?? -1] : undefined;
  const code = issue.code === 'section_empty' ? 'empty_section' : issue.code;
  const key = KNOWN.has(code) || code === 'empty_section' ? code : 'unknown';
  return {
    key,
    values: {
      code: issue.code,
      label: step?.label || '',
      title: sec?.title ?? '',
      section: p ? p.section + 1 : 0,
    },
  };
}
