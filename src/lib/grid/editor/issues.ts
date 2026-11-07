// Live validation for the editor: the shared validateRecipeGrid (same function as the API),
// plus the content rules the input schema enforces, plus the path parser that maps an issue
// path (`sections.0.steps.1.row_end`), from here or from a 422 response, to editor keys (G2).

import { sectionInputSchema, zodIssuesToErrors } from '@/lib/recipes/schemas';
import { validateRecipeGrid, type GridIssue } from '../validate';
import { docToPayloadSections, doc, type EditorDoc, type EditorState } from './state';

export type IssueTarget = {
  sectionKey: string;
  rowKey?: string;
  stepKey?: string;
  /** Offending field name when the path ends in one (`row_end`, `name`, `title`...). */
  field?: string;
};

export type EditorIssue = GridIssue & { target: IssueTarget | null };
export type EditorIssues = { errors: EditorIssue[]; warnings: EditorIssue[] };

export type ParsedPath = {
  section: number;
  kind: 'section' | 'ingredient' | 'step';
  index?: number;
  field?: string;
};

const PATH_RE = /^sections\.(\d+)(?:\.(ingredients|steps)\.(\d+)(?:\.([A-Za-z_]+))?|\.(title))?$/;

/** Pure path parser; `null` for anything that is not a section / ingredient / step path. */
export function parseIssuePath(path: string): ParsedPath | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const section = Number(m[1]);
  if (m[5]) return { section, kind: 'section', field: 'title' };
  if (!m[2]) return { section, kind: 'section' };
  return {
    section,
    kind: m[2] === 'ingredients' ? 'ingredient' : 'step',
    index: Number(m[3]),
    ...(m[4] ? { field: m[4] } : {}),
  };
}

/** Resolve a path against the current document; `null` if unparseable or out of range. */
export function resolveIssueTarget(d: EditorDoc, path: string): IssueTarget | null {
  const p = parseIssuePath(path);
  if (!p) return null;
  const sec = d.sections[p.section];
  if (!sec) return null;
  const base: IssueTarget = { sectionKey: sec.key };
  if (p.field) base.field = p.field;
  if (p.kind === 'section') return base;
  if (p.kind === 'ingredient') {
    const row = sec.ingredients[p.index!];
    return row ? { ...base, rowKey: row.key } : null;
  }
  const step = sec.steps[p.index!];
  return step ? { ...base, stepKey: step.key } : null;
}

/** Map server 422 `errors[]` (same paths as here) to editor targets. */
export function mapServerErrors(d: EditorDoc, errors: GridIssue[]): EditorIssue[] {
  return errors.map((e) => ({ ...e, target: resolveIssueTarget(d, e.path) }));
}

/**
 * Error codes added here (all content rules of `sectionInputSchema`): `name_empty`,
 * `banner_empty` (UI key `issue.banner_empty`), `label_empty`. Warning: `section_empty`.
 * Anything else the schema would reject (limits, qty_range_order, minutes_order) is reported
 * with the schema's own code, so a payload with no errors here is accepted by the API.
 */
export function issuesFor(input: EditorState | EditorDoc): EditorIssues {
  const d: EditorDoc = 'history' in input ? doc(input) : input;
  const payload = docToPayloadSections(d);
  const { errors: gridErrors, warnings: gridWarnings } = validateRecipeGrid({
    sections: payload,
  });
  const errors: GridIssue[] = [...gridErrors];
  const warnings: GridIssue[] = [...gridWarnings];
  const seen = new Set(errors.map((e) => e.path));
  const add = (e: GridIssue) => {
    if (seen.has(e.path)) return;
    seen.add(e.path);
    errors.push(e);
  };

  d.sections.forEach((sec, si) => {
    const base = `sections.${si}.`;
    sec.ingredients.forEach((ing, ii) => {
      if (ing.name.trim() === '')
        add({ path: `${base}ingredients.${ii}.name`, code: 'name_empty' });
    });
    sec.steps.forEach((st, ti) => {
      if (st.label.trim() === '') {
        add({
          path: `${base}steps.${ti}.label`,
          code: st.kind === 'column' ? 'label_empty' : 'banner_empty',
        });
      }
    });
    if (sec.ingredients.length === 0)
      warnings.push({ path: `sections.${si}`, code: 'section_empty' });
    // Residual schema rules (lengths, caps, range/time order) so "no errors" means "API accepts".
    const parsed = sectionInputSchema.safeParse(payload[si]);
    if (!parsed.success) {
      for (const e of zodIssuesToErrors(parsed.error)) add({ path: base + e.path, code: e.code });
    }
  });

  const withTarget = (e: GridIssue): EditorIssue => ({
    ...e,
    target: resolveIssueTarget(d, e.path),
  });
  return { errors: errors.map(withTarget), warnings: warnings.map(withTarget) };
}

export function hasErrors(input: EditorState | EditorDoc): boolean {
  return issuesFor(input).errors.length > 0;
}
