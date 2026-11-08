// Pure editor reducer. Rules:
// - Indices address the current document (section, row, step = index in section.steps).
// - An out-of-range index, a no-op change or an action refused by a cap/rule returns the
//   SAME state reference (callers can compare identity; use the can* helpers to pre-check).
// - Spans follow their ingredients (Q1); see spans.ts for the arithmetic.
// - History is snapshots of the document only; selection and notice live outside it.
// - Text-like edits coalesce into one undo entry when they carry the same `groupKey`.

import {
  canRedo as hCanRedo,
  canUndo as hCanUndo,
  commit,
  isDirty as hIsDirty,
  markSaved as hMarkSaved,
  redo as hRedo,
  undo as hUndo,
} from './history';
import {
  clampSpan,
  defaultSpan,
  deleteRowSpans,
  insertRowSpans,
  moveRowSpans,
  spanOf,
  splitRowSpans,
} from './spans';
import {
  LIMITS,
  canonicalSteps,
  doc,
  fromApiRecipe,
  newKey,
  type ApiRecipeLike,
  type EditorDoc,
  type EditorIngredient,
  type EditorNotice,
  type EditorSection,
  type EditorState,
  type EditorStep,
  type IngredientFields,
  type Selection,
  type StepFields,
  type StepKind,
} from './state';

/** Fields a free-text edit may change (the UI parses the line, G11, and sends the result). */
export type TextPatch = Partial<
  Pick<
    IngredientFields,
    | 'name'
    | 'note'
    | 'raw_text'
    | 'metric_qty'
    | 'metric_qty_max'
    | 'metric_unit'
    | 'us_qty'
    | 'us_qty_max'
    | 'us_unit'
    | 'display_primary'
  >
>;

export type EditableField = 'portion_label' | 'group_label';

export type EditorAction =
  | { type: 'rowMove'; section: number; from: number; to: number }
  | { type: 'rowAdd'; section: number; at?: number; ingredient?: Partial<IngredientFields> }
  | { type: 'rowDelete'; section: number; row: number }
  | { type: 'rowSplit'; section: number; row: number }
  | { type: 'rowEditText'; section: number; row: number; patch: TextPatch; groupKey?: string }
  | {
      type: 'rowEditField';
      section: number;
      row: number;
      field: EditableField;
      value: string | null;
      groupKey?: string;
    }
  | { type: 'stepAdd'; section: number; at?: number; step?: Partial<StepFields> }
  | {
      type: 'bannerAdd';
      section: number;
      kind: 'banner_top' | 'banner_bottom';
      at?: number;
      step?: Partial<StepFields>;
    }
  | { type: 'stepDelete'; section: number; step: number }
  | { type: 'stepMove'; section: number; step: number; to: number }
  | { type: 'stepSetSpan'; section: number; step: number; start: number; end: number }
  | {
      type: 'stepGrowStart' | 'stepShrinkStart' | 'stepGrowEnd' | 'stepShrinkEnd';
      section: number;
      step: number;
    }
  | { type: 'stepConvert'; section: number; step: number; to?: StepKind }
  | {
      type: 'stepEdit';
      section: number;
      step: number;
      patch: Partial<StepFields>;
      groupKey?: string;
    }
  | { type: 'sectionAdd'; at?: number; title?: string | null }
  | { type: 'sectionRename'; section: number; title: string | null; groupKey?: string }
  | { type: 'sectionDelete'; section: number }
  | { type: 'sectionMove'; section: number; to: number }
  | { type: 'select'; stepKey?: string | null; rowKey?: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  /** `doc` is the document that was sent; applies only while it is still the present one. */
  | { type: 'markSaved'; doc: EditorDoc }
  | { type: 'reset'; recipe: ApiRecipeLike };

// ---- helpers ----------------------------------------------------------------------------

const isIdx = (n: unknown, len: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < len;
const isInsertIdx = (n: number, len: number) => Number.isInteger(n) && n >= 0 && n <= len;

const blank = (v: string | null | undefined) => (v == null || v.trim() === '' ? null : v);

function blankIngredient(key: string): EditorIngredient {
  return {
    key,
    name: '',
    note: null,
    raw_text: null,
    metric_qty: null,
    metric_qty_max: null,
    metric_unit: null,
    us_qty: null,
    us_qty_max: null,
    us_unit: null,
    display_primary: 'metric',
    split_group: null,
    portion_label: null,
    group_label: null,
  };
}

function blankStep(key: string, kind: StepKind): EditorStep {
  return {
    key,
    kind,
    label: '',
    detail: '',
    row_start: null,
    row_end: null,
    temp_c: null,
    temp_f: null,
    minutes_min: null,
    minutes_max: null,
  };
}

function setSection(d: EditorDoc, si: number, sec: EditorSection): EditorDoc {
  const sections = d.sections.slice();
  sections[si] = sec;
  return { sections };
}

const sectionOf = (s: EditorState, si: number): EditorSection | null => {
  const sec = doc(s).sections[si];
  return isIdx(si, doc(s).sections.length) && sec ? sec : null;
};

function sanitizeSelection(sel: Selection, d: EditorDoc): Selection {
  const steps = new Set<string>();
  const rows = new Set<string>();
  for (const sec of d.sections) {
    sec.steps.forEach((t) => steps.add(t.key));
    sec.ingredients.forEach((i) => rows.add(i.key));
  }
  const stepKey = sel.stepKey && steps.has(sel.stepKey) ? sel.stepKey : null;
  const rowKey = sel.rowKey && rows.has(sel.rowKey) ? sel.rowKey : null;
  return stepKey === sel.stepKey && rowKey === sel.rowKey ? sel : { stepKey, rowKey };
}

type Extra = {
  groupKey?: string;
  notice?: EditorNotice | null;
  selection?: Selection;
  nextKey?: number;
};

function apply(state: EditorState, next: EditorDoc, extra: Extra = {}): EditorState {
  if (next === doc(state)) return state;
  const selection = sanitizeSelection(extra.selection ?? state.selection, next);
  return {
    ...state,
    history: commit(state.history, next, extra.groupKey),
    selection,
    notice: extra.notice ?? null,
    nextKey: extra.nextKey ?? state.nextKey,
  };
}

const groupRange = (steps: EditorStep[], kind: StepKind): [number, number] => {
  const first = steps.findIndex((t) => t.kind === kind);
  if (first < 0) {
    // Insert position of an empty group: after all lower-ranked kinds.
    const rank = { banner_top: 0, column: 1, banner_bottom: 2 } as const;
    const at = steps.filter((t) => rank[t.kind] < rank[kind]).length;
    return [at, at];
  }
  const count = steps.filter((t) => t.kind === kind).length;
  return [first, first + count];
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const half = (n: number | null) => (n == null ? null : round4(n / 2));

function clearSide(i: EditorIngredient, side: 'metric' | 'us'): EditorIngredient {
  return { ...i, [`${side}_qty`]: null, [`${side}_qty_max`]: null, [`${side}_unit`]: null };
}

const sides = (primary: 'metric' | 'us') =>
  primary === 'metric'
    ? { p: 'metric' as const, o: 'us' as const }
    : { p: 'us' as const, o: 'metric' as const };

// ---- caps (pre-check helpers for the UI) ------------------------------------------------

export const canAddRow = (s: EditorState, si: number) => {
  const sec = sectionOf(s, si);
  return !!sec && sec.ingredients.length < LIMITS.ingredients;
};
export const canAddStep = (s: EditorState, si: number) => {
  const sec = sectionOf(s, si);
  return !!sec && sec.steps.length < LIMITS.steps;
};
/** A column step needs at least one row (rule: span within the section's rows). */
export const canAddColumnStep = (s: EditorState, si: number) =>
  canAddStep(s, si) && (sectionOf(s, si)?.ingredients.length ?? 0) > 0;
export const canAddSection = (s: EditorState) => doc(s).sections.length < LIMITS.sections;
export const canDeleteSection = (s: EditorState) => doc(s).sections.length > 1;
export const canUndo = (s: EditorState) => hCanUndo(s.history);
export const canRedo = (s: EditorState) => hCanRedo(s.history);
export const isDirty = (s: EditorState) => hIsDirty(s.history);

// ---- reducer ----------------------------------------------------------------------------

export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'rowMove': {
      const sec = sectionOf(state, action.section);
      if (!sec) return state;
      const { from, to } = action;
      const n = sec.ingredients.length;
      if (!isIdx(from, n) || !isIdx(to, n) || from === to) return state;
      const ingredients = sec.ingredients.slice();
      const [moved] = ingredients.splice(from, 1);
      ingredients.splice(to, 0, moved);
      const next = setSection(doc(state), action.section, {
        ...sec,
        ingredients,
        steps: moveRowSpans(sec.steps, from, to),
      });
      return apply(state, next, { selection: { ...state.selection, rowKey: moved.key } });
    }

    case 'rowAdd': {
      const sec = sectionOf(state, action.section);
      if (!sec || sec.ingredients.length >= LIMITS.ingredients) return state;
      const at = action.at ?? sec.ingredients.length;
      if (!isInsertIdx(at, sec.ingredients.length)) return state;
      const row: EditorIngredient = {
        ...blankIngredient(newKey(state.nextKey)),
        ...action.ingredient,
        // Keys, groups and the label belong to the reducer / split logic, not to the patch.
        key: newKey(state.nextKey),
        split_group: null,
      };
      const ingredients = sec.ingredients.slice();
      ingredients.splice(at, 0, row);
      const next = setSection(doc(state), action.section, {
        ...sec,
        ingredients,
        steps: insertRowSpans(sec.steps, at),
      });
      return apply(state, next, {
        nextKey: state.nextKey + 1,
        selection: { ...state.selection, rowKey: row.key },
      });
    }

    case 'rowDelete': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.row, sec.ingredients.length)) return state;
      const gone = sec.ingredients[action.row];
      let ingredients = sec.ingredients.filter((_, i) => i !== action.row);
      if (gone.split_group) {
        const rest = ingredients.filter((i) => i.split_group === gone.split_group);
        if (rest.length === 1) {
          // A lone portion is just an ingredient again.
          ingredients = ingredients.map((i) =>
            i === rest[0] ? { ...i, split_group: null, portion_label: null } : i,
          );
        }
      }
      const { steps, removed } = deleteRowSpans(sec.steps, action.row);
      const next = setSection(doc(state), action.section, { ...sec, ingredients, steps });
      return apply(state, next, {
        notice: removed.length
          ? {
              type: 'stepsRemoved',
              stepKeys: removed.map((t) => t.key),
              labels: removed.map((t) => t.label),
            }
          : null,
      });
    }

    case 'rowSplit': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.row, sec.ingredients.length)) return state;
      if (sec.ingredients.length >= LIMITS.ingredients) return state;
      const src = sec.ingredients[action.row];
      const grouped = src.split_group !== null;
      const group = src.split_group ?? newKey(state.nextKey);
      const { p, o } = sides(src.display_primary);
      const qty = src[`${p}_qty`];
      const halved = qty !== null;
      let first: EditorIngredient = { ...src, split_group: group };
      if (!grouped) first.portion_label = 'half';
      if (halved) {
        first = {
          ...first,
          [`${p}_qty`]: half(qty),
          [`${p}_qty_max`]: half(src[`${p}_qty_max`]),
          raw_text: null,
        };
        first = clearSide(first, o); // C7: derived server-side
      }
      const second: EditorIngredient = {
        ...first,
        key: newKey(grouped ? state.nextKey : state.nextKey + 1),
        portion_label: 'remaining',
      };
      const ingredients = sec.ingredients.slice();
      ingredients.splice(action.row, 1, first, second);
      const next = setSection(doc(state), action.section, {
        ...sec,
        ingredients,
        steps: splitRowSpans(sec.steps, action.row),
      });
      return apply(state, next, {
        nextKey: state.nextKey + (grouped ? 1 : 2),
        selection: { ...state.selection, rowKey: second.key },
      });
    }

    case 'rowEditText': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.row, sec.ingredients.length)) return state;
      const old = sec.ingredients[action.row];
      const patch = action.patch;
      let row: EditorIngredient = { ...old };
      for (const k of Object.keys(patch) as (keyof TextPatch)[]) {
        const v = patch[k];
        if (v !== undefined) (row as Record<string, unknown>)[k] = v;
      }
      // C7: when the primary side (or which side is primary) changed, the other side is stale,
      // so clear it unless this very edit supplies it.
      const { p, o } = sides(row.display_primary);
      const primaryChanged =
        row.display_primary !== old.display_primary ||
        row[`${p}_qty`] !== old[`${p}_qty`] ||
        row[`${p}_qty_max`] !== old[`${p}_qty_max`] ||
        row[`${p}_unit`] !== old[`${p}_unit`];
      const otherSupplied = `${o}_qty` in patch || `${o}_qty_max` in patch || `${o}_unit` in patch;
      if (primaryChanged && !otherSupplied) row = clearSide(row, o);
      const changed = (Object.keys(row) as (keyof EditorIngredient)[]).some(
        (k) => row[k] !== old[k],
      );
      if (!changed) return state;
      const ingredients = sec.ingredients.slice();
      ingredients[action.row] = row;
      return apply(state, setSection(doc(state), action.section, { ...sec, ingredients }), {
        groupKey: action.groupKey,
      });
    }

    case 'rowEditField': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.row, sec.ingredients.length)) return state;
      if (action.field !== 'portion_label' && action.field !== 'group_label') return state;
      const old = sec.ingredients[action.row];
      const value = blank(action.value);
      if (old[action.field] === value) return state;
      const ingredients = sec.ingredients.slice();
      ingredients[action.row] = { ...old, [action.field]: value };
      return apply(state, setSection(doc(state), action.section, { ...sec, ingredients }), {
        groupKey: action.groupKey,
      });
    }

    case 'stepAdd':
    case 'bannerAdd': {
      const sec = sectionOf(state, action.section);
      if (!sec || sec.steps.length >= LIMITS.steps) return state;
      const kind: StepKind = action.type === 'stepAdd' ? 'column' : action.kind;
      if (kind !== 'column' && kind !== 'banner_top' && kind !== 'banner_bottom') return state;
      const [lo, hi] = groupRange(sec.steps, kind);
      const at = action.at ?? hi - lo;
      if (!isInsertIdx(at, hi - lo)) return state;
      const step: EditorStep = { ...blankStep(newKey(state.nextKey), kind), ...action.step, kind };
      step.key = newKey(state.nextKey);
      if (kind === 'column') {
        const span = defaultSpan(sec.steps, sec.ingredients.length);
        if (!span) return state; // no rows: a column step has nothing to span
        step.row_start = span.start;
        step.row_end = span.end;
      } else {
        step.row_start = null;
        step.row_end = null;
      }
      const steps = sec.steps.slice();
      steps.splice(lo + at, 0, step);
      return apply(state, setSection(doc(state), action.section, { ...sec, steps }), {
        nextKey: state.nextKey + 1,
        selection: { ...state.selection, stepKey: step.key },
      });
    }

    case 'stepDelete': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.step, sec.steps.length)) return state;
      const steps = sec.steps.filter((_, i) => i !== action.step);
      return apply(state, setSection(doc(state), action.section, { ...sec, steps }));
    }

    case 'stepMove': {
      const sec = sectionOf(state, action.section);
      if (!sec) return state;
      const { step, to } = action;
      if (!isIdx(step, sec.steps.length) || !isIdx(to, sec.steps.length) || step === to)
        return state;
      // Only within the same kind (G9): kinds are contiguous, so check the destination's kind.
      if (sec.steps[step].kind !== sec.steps[to].kind) return state;
      const steps = sec.steps.slice();
      const [moved] = steps.splice(step, 1);
      steps.splice(to, 0, moved);
      return apply(state, setSection(doc(state), action.section, { ...sec, steps }));
    }

    case 'stepSetSpan':
    case 'stepGrowStart':
    case 'stepShrinkStart':
    case 'stepGrowEnd':
    case 'stepShrinkEnd': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.step, sec.steps.length)) return state;
      const st = sec.steps[action.step];
      const n = sec.ingredients.length;
      let start: number;
      let end: number;
      if (action.type === 'stepSetSpan') {
        if (st.kind !== 'column') return state;
        const c = clampSpan(action.start, action.end, n);
        if (!c) return state;
        ({ start, end } = c);
      } else {
        const sp = spanOf(st);
        if (!sp) return state;
        start = sp.start;
        end = sp.end;
        if (action.type === 'stepGrowStart') {
          if (start <= 0) return state;
          start -= 1;
        } else if (action.type === 'stepShrinkStart') {
          if (start >= end) return state;
          start += 1;
        } else if (action.type === 'stepGrowEnd') {
          if (end >= n - 1) return state;
          end += 1;
        } else {
          if (end <= start) return state;
          end -= 1;
        }
      }
      if (st.row_start === start && st.row_end === end) return state;
      const steps = sec.steps.slice();
      steps[action.step] = { ...st, row_start: start, row_end: end };
      return apply(state, setSection(doc(state), action.section, { ...sec, steps }), {
        selection: { ...state.selection, stepKey: st.key },
      });
    }

    case 'stepConvert': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.step, sec.steps.length)) return state;
      const st = sec.steps[action.step];
      const rows = sec.ingredients.length;
      let to: StepKind;
      if (action.to !== undefined) to = action.to;
      else if (st.kind === 'column') to = st.row_end === rows - 1 ? 'banner_bottom' : 'banner_top';
      else to = 'column';
      if (to === st.kind || (to !== 'column' && to !== 'banner_top' && to !== 'banner_bottom')) {
        return state;
      }
      const rest = sec.steps.filter((_, i) => i !== action.step);
      let converted: EditorStep;
      if (to === 'column') {
        const span = defaultSpan(rest, rows);
        if (!span) return state;
        converted = { ...st, kind: 'column', row_start: span.start, row_end: span.end };
      } else {
        converted = { ...st, kind: to, row_start: null, row_end: null };
      }
      const [, hi] = groupRange(rest, to);
      rest.splice(hi, 0, converted);
      return apply(
        state,
        setSection(doc(state), action.section, { ...sec, steps: canonicalSteps(rest) }),
        {
          selection: { ...state.selection, stepKey: st.key },
        },
      );
    }

    case 'stepEdit': {
      const sec = sectionOf(state, action.section);
      if (!sec || !isIdx(action.step, sec.steps.length)) return state;
      const old = sec.steps[action.step];
      const st: EditorStep = { ...old };
      for (const k of Object.keys(action.patch) as (keyof StepFields)[]) {
        const v = action.patch[k];
        if (v !== undefined) (st as Record<string, unknown>)[k] = v;
      }
      if ((Object.keys(st) as (keyof EditorStep)[]).every((k) => st[k] === old[k])) return state;
      const steps = sec.steps.slice();
      steps[action.step] = st;
      return apply(state, setSection(doc(state), action.section, { ...sec, steps }), {
        groupKey: action.groupKey,
      });
    }

    case 'sectionAdd': {
      const d = doc(state);
      if (d.sections.length >= LIMITS.sections) return state;
      const at = action.at ?? d.sections.length;
      if (!isInsertIdx(at, d.sections.length)) return state;
      // Default (O2, checked against sectionInputSchema: zero ingredients are allowed): no rows,
      // no steps, no title; the editor shows the `section_empty` warning.
      const sec: EditorSection = {
        key: newKey(state.nextKey),
        title: blank(action.title),
        ingredients: [],
        steps: [],
      };
      const sections = d.sections.slice();
      sections.splice(at, 0, sec);
      return apply(state, { sections }, { nextKey: state.nextKey + 1 });
    }

    case 'sectionRename': {
      const sec = sectionOf(state, action.section);
      if (!sec) return state;
      const title = blank(action.title);
      if (sec.title === title) return state;
      return apply(state, setSection(doc(state), action.section, { ...sec, title }), {
        groupKey: action.groupKey,
      });
    }

    case 'sectionDelete': {
      const d = doc(state);
      if (d.sections.length <= 1 || !isIdx(action.section, d.sections.length)) return state;
      return apply(state, { sections: d.sections.filter((_, i) => i !== action.section) });
    }

    case 'sectionMove': {
      const d = doc(state);
      const { section, to } = action;
      if (!isIdx(section, d.sections.length) || !isIdx(to, d.sections.length) || section === to) {
        return state;
      }
      const sections = d.sections.slice();
      const [moved] = sections.splice(section, 1);
      sections.splice(to, 0, moved);
      return apply(state, { sections });
    }

    case 'select': {
      const next = sanitizeSelection(
        {
          stepKey: action.stepKey === undefined ? state.selection.stepKey : action.stepKey,
          rowKey: action.rowKey === undefined ? state.selection.rowKey : action.rowKey,
        },
        doc(state),
      );
      const cur = state.selection;
      return next.stepKey === cur.stepKey && next.rowKey === cur.rowKey
        ? state
        : { ...state, selection: next };
    }

    case 'undo': {
      const history = hUndo(state.history);
      if (history === state.history) return state;
      return {
        ...state,
        history,
        selection: sanitizeSelection(state.selection, history.present),
        notice: null,
      };
    }

    case 'redo': {
      const history = hRedo(state.history);
      if (history === state.history) return state;
      return {
        ...state,
        history,
        selection: sanitizeSelection(state.selection, history.present),
        notice: null,
      };
    }

    case 'markSaved': {
      if (state.history.present !== action.doc) return state;
      const history = hMarkSaved(state.history);
      return history === state.history ? state : { ...state, history };
    }

    case 'reset':
      return fromApiRecipe(action.recipe);
  }
}

/** Fold a list of actions (handy for tests and for the sample-recreation twin). */
export function run(state: EditorState, actions: EditorAction[]): EditorState {
  return actions.reduce(reduce, state);
}
