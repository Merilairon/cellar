// Pure render model for one section, consumed by the presentational RecipeGrid.
// Banners never consume a column index (data-model §2 "Rendering").

export type LayoutStep = {
  kind: 'banner_top' | 'column' | 'banner_bottom';
  position?: number;
  row_start?: number | null;
  row_end?: number | null;
};

export type LayoutColumn<S> = {
  step: S;
  /** 0-based index among column steps only. */
  columnIndex: number;
  rowStart: number;
  rowEnd: number;
  rowSpan: number;
};

export type LayoutCell<S> =
  { type: 'step'; column: LayoutColumn<S> } | { type: 'empty'; columnIndex: number };

export type SectionLayout<S> = {
  rowCount: number;
  bannersTop: S[];
  bannersBottom: S[];
  columns: LayoutColumn<S>[];
  /** Per ingredient row: the cells to emit for that table row, in column order. */
  rows: LayoutCell<S>[][];
};

/** Sort by kind order is handled by the caller's grouping; within a kind use position, then input order. */
function byPosition<S extends LayoutStep>(steps: S[]): S[] {
  return steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.position ?? a.i) - (b.s.position ?? b.i) || a.i - b.i)
    .map((x) => x.s);
}

export function buildSectionLayout<S extends LayoutStep>(
  ingredientCount: number,
  steps: S[],
): SectionLayout<S> {
  const ordered = byPosition(steps);
  const bannersTop = ordered.filter((s) => s.kind === 'banner_top');
  const bannersBottom = ordered.filter((s) => s.kind === 'banner_bottom');
  const columns: LayoutColumn<S>[] = [];
  for (const step of ordered) {
    if (step.kind !== 'column') continue;
    const s = step.row_start ?? null;
    const e = step.row_end ?? null;
    // Steps without a usable span cannot be placed in a grid (list-mode recipe).
    if (s === null || e === null || s < 0 || e < s || e >= ingredientCount) continue;
    columns.push({ step, columnIndex: columns.length, rowStart: s, rowEnd: e, rowSpan: e - s + 1 });
  }
  const rows: LayoutCell<S>[][] = [];
  for (let r = 0; r < ingredientCount; r++) {
    const cells: LayoutCell<S>[] = [];
    for (const c of columns) {
      if (c.rowStart === r) cells.push({ type: 'step', column: c });
      else if (r < c.rowStart || r > c.rowEnd)
        cells.push({ type: 'empty', columnIndex: c.columnIndex });
      // else: covered by a rowspan from an earlier row; emit nothing.
    }
    rows.push(cells);
  }
  return { rowCount: ingredientCount, bannersTop, bannersBottom, columns, rows };
}
