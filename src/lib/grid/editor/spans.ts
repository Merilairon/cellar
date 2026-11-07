// Pure span arithmetic for the grid editor (tasklist G6, owner decision Q1: spans follow
// the ingredients). Rows are 0-based indices; spans are inclusive. Only column steps with
// both bounds set carry a span; everything else is returned untouched (same reference).

export type SpanStep = {
  kind: 'banner_top' | 'column' | 'banner_bottom';
  row_start: number | null;
  row_end: number | null;
};

export type Span = { start: number; end: number };

export function spanOf(step: SpanStep): Span | null {
  if (step.kind !== 'column' || step.row_start === null || step.row_end === null) return null;
  return { start: step.row_start, end: step.row_end };
}

function withSpan<S extends SpanStep>(step: S, start: number, end: number): S {
  return step.row_start === start && step.row_end === end
    ? step
    : { ...step, row_start: start, row_end: end };
}

/** Where the row that sits at index `p` ends up after moving row `from` to index `to`. */
export function mapMovedRow(p: number, from: number, to: number): number {
  if (p === from) return to;
  if (from < to && p > from && p <= to) return p - 1;
  if (to < from && p >= to && p < from) return p + 1;
  return p;
}

/** (a) Move: each step keeps the same set of ingredients; its span is the hull of their new positions. */
export function moveRowSpans<S extends SpanStep>(steps: S[], from: number, to: number): S[] {
  return steps.map((st) => {
    const sp = spanOf(st);
    if (!sp) return st;
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = sp.start; r <= sp.end; r++) {
      const m = mapMovedRow(r, from, to);
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
    return withSpan(st, lo, hi);
  });
}

/**
 * (b) Delete: later rows shift up; a span containing the row shrinks by one; a span whose only
 * row was deleted is removed (`removed` lists those steps so the UI can announce it, Q2).
 */
export function deleteRowSpans<S extends SpanStep>(
  steps: S[],
  row: number,
): { steps: S[]; removed: S[] } {
  const kept: S[] = [];
  const removed: S[] = [];
  for (const st of steps) {
    const sp = spanOf(st);
    if (!sp) {
      kept.push(st);
      continue;
    }
    if (sp.start === row && sp.end === row) {
      removed.push(st);
      continue;
    }
    kept.push(
      withSpan(st, sp.start > row ? sp.start - 1 : sp.start, sp.end >= row ? sp.end - 1 : sp.end),
    );
  }
  return { steps: kept, removed };
}

/**
 * (c) Insert a new row at index `at`: a step covers it only when inserted strictly inside
 * (`row_start < at <= row_end`); steps from `at` on shift down; others are unchanged.
 */
export function insertRowSpans<S extends SpanStep>(steps: S[], at: number): S[] {
  return steps.map((st) => {
    const sp = spanOf(st);
    if (!sp) return st;
    if (sp.start >= at) return withSpan(st, sp.start + 1, sp.end + 1);
    if (sp.end >= at) return withSpan(st, sp.start, sp.end + 1);
    return st;
  });
}

/**
 * (d) Split the row at `row` into `row` and `row + 1`: every step covering `row` covers both
 * (hull); steps after shift down; steps before are unchanged.
 */
export function splitRowSpans<S extends SpanStep>(steps: S[], row: number): S[] {
  return steps.map((st) => {
    const sp = spanOf(st);
    if (!sp) return st;
    if (sp.start > row) return withSpan(st, sp.start + 1, sp.end + 1);
    if (sp.end >= row) return withSpan(st, sp.start, sp.end + 1);
    return st;
  });
}

/** Clamp a span into `[0, rowCount - 1]` and order it. `null` when there are no rows or input is not finite. */
export function clampSpan(start: number, end: number, rowCount: number): Span | null {
  if (rowCount <= 0 || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  const max = rowCount - 1;
  const s = Math.min(Math.max(Math.trunc(start), 0), max);
  const e = Math.min(Math.max(Math.trunc(end), 0), max);
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

/** `covered[r]` is true when some column step spans row `r`. Out-of-range bounds are ignored. */
export function rowsCovered(steps: SpanStep[], rowCount: number): boolean[] {
  const covered = new Array<boolean>(Math.max(rowCount, 0)).fill(false);
  for (const st of steps) {
    const sp = spanOf(st);
    if (!sp) continue;
    for (let r = Math.max(sp.start, 0); r <= Math.min(sp.end, rowCount - 1); r++) covered[r] = true;
  }
  return covered;
}

export function uncoveredRows(steps: SpanStep[], rowCount: number): number[] {
  const out: number[] = [];
  rowsCovered(steps, rowCount).forEach((c, r) => {
    if (!c) out.push(r);
  });
  return out;
}

/** Labels of the column steps covering `row`, in step order (for "Butter: mix, fold in"). */
export function coverageNames(steps: (SpanStep & { label: string })[], row: number): string[] {
  const names: string[] = [];
  for (const st of steps) {
    const sp = spanOf(st);
    if (sp && sp.start <= row && row <= sp.end) names.push(st.label);
  }
  return names;
}

/** Default span for a new or converted column step: the first uncovered row, else all rows (G8). */
export function defaultSpan(steps: SpanStep[], rowCount: number): Span | null {
  if (rowCount <= 0) return null;
  const first = uncoveredRows(steps, rowCount)[0];
  return first === undefined ? { start: 0, end: rowCount - 1 } : { start: first, end: first };
}
