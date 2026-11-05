// Pure grid span validation (data-model §2 rules 1-6). Shared by the API, the
// service defaults (view_mode) and the Convert-to-grid editor.

export type GridIssue = { path: string; code: string };
export type GridValidation = { errors: GridIssue[]; warnings: GridIssue[] };

export type GridIngredient = {
  /** 0-based row index. When omitted, the array index is used. */
  position?: number;
  split_group_id?: string | null;
};
export type GridStep = {
  kind: 'banner_top' | 'column' | 'banner_bottom';
  row_start?: number | null;
  row_end?: number | null;
};
export type GridSection = { ingredients: GridIngredient[]; steps: GridStep[] };

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/**
 * Rules 1-3 (errors) and 5 (warning) for one section. `base` prefixes every path, e.g.
 * `sections.0.` so paths match the API payload.
 *
 * Error codes: positions_not_contiguous, banner_has_span, span_required_for_grid,
 * span_incomplete, row_order, row_out_of_range, no_rows. Warning: row_uncovered.
 * Rule 4 (ordering) is derived from `kind` by the layout helper, so it cannot be violated.
 */
export function validateSection(section: GridSection, base = ''): GridValidation {
  const errors: GridIssue[] = [];
  const warnings: GridIssue[] = [];
  const rows = section.ingredients.length;

  // Rule 1: positions are 0..n-1 with no gaps or duplicates.
  const positions = section.ingredients.map((g, i) => g.position ?? i);
  const sorted = [...positions].sort((a, b) => a - b);
  if (sorted.some((p, i) => p !== i)) {
    const bad = positions.findIndex(
      (p) => p < 0 || p >= rows || positions.indexOf(p) !== positions.lastIndexOf(p),
    );
    errors.push({
      path: `${base}ingredients.${Math.max(bad, 0)}.position`,
      code: 'positions_not_contiguous',
    });
  }

  const covered = new Array<boolean>(rows).fill(false);
  section.steps.forEach((st, j) => {
    const p = `${base}steps.${j}.`;
    const s = st.row_start ?? null;
    const e = st.row_end ?? null;
    if (st.kind !== 'column') {
      if (s !== null || e !== null) {
        errors.push({
          path: `${p}${s !== null ? 'row_start' : 'row_end'}`,
          code: 'banner_has_span',
        });
      }
      return;
    }
    if (s === null && e === null) {
      errors.push({ path: `${p}row_start`, code: 'span_required_for_grid' });
      return;
    }
    if (s === null || e === null) {
      errors.push({ path: `${p}${s === null ? 'row_start' : 'row_end'}`, code: 'span_incomplete' });
      return;
    }
    if (rows === 0) {
      errors.push({ path: `${p}row_start`, code: 'no_rows' });
      return;
    }
    // Rule 2 (range) and rule 3 (at least one row: start <= end implies >= 1 row).
    let ok = true;
    if (!isInt(s) || s < 0 || s >= rows) {
      errors.push({ path: `${p}row_start`, code: 'row_out_of_range' });
      ok = false;
    }
    if (!isInt(e) || e < 0 || e >= rows) {
      errors.push({ path: `${p}row_end`, code: 'row_out_of_range' });
      ok = false;
    }
    if (ok && s > e) {
      errors.push({ path: `${p}row_end`, code: 'row_order' });
      ok = false;
    }
    if (ok) for (let r = s; r <= e; r++) covered[r] = true;
  });

  // Rule 5: warn only, and only when there is at least one column step.
  if (section.steps.some((st) => st.kind === 'column')) {
    covered.forEach((c, r) => {
      if (!c) warnings.push({ path: `${base}ingredients.${r}`, code: 'row_uncovered' });
    });
  }
  return { errors, warnings };
}

/** Every section plus rule 6: a split group must not span sections. */
export function validateRecipeGrid(recipe: { sections: GridSection[] }): GridValidation {
  const errors: GridIssue[] = [];
  const warnings: GridIssue[] = [];
  const groupSection = new Map<string, number>();
  recipe.sections.forEach((sec, si) => {
    const r = validateSection(sec, `sections.${si}.`);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    sec.ingredients.forEach((g, gi) => {
      const id = g.split_group_id;
      if (!id) return;
      const first = groupSection.get(id);
      if (first === undefined) groupSection.set(id, si);
      else if (first !== si) {
        errors.push({
          path: `sections.${si}.ingredients.${gi}.split_group_id`,
          code: 'split_group_cross_section',
        });
      }
    });
  });
  return { errors, warnings };
}

export function isGridValid(recipe: { sections: GridSection[] }): boolean {
  return validateRecipeGrid(recipe).errors.length === 0;
}
