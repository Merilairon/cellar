// Editor session: wraps the T2 reducer without changing its semantics. Adds two things the UI
// needs and the pure reducer does not carry: a label stack that mirrors undo/redo (so the
// toolbar can say what Undo will undo) and at most one announcement per dispatched action
// (UX spec 15). Pure: no React, DOM or timers.

import {
  HISTORY_CAP,
  doc,
  fromApiRecipe,
  reduce,
  uncoveredRows,
  type ApiRecipeLike,
  type EditorAction,
  type EditorDoc,
  type EditorState,
} from '@/lib/grid/editor';

/** Keys under `gridEditor.history.*`. */
export type ActionLabel =
  | 'rowMove'
  | 'rowAdd'
  | 'rowDelete'
  | 'rowSplit'
  | 'rowEdit'
  | 'stepAdd'
  | 'stepDelete'
  | 'stepMove'
  | 'stepResize'
  | 'stepConvert'
  | 'stepEdit'
  | 'bannerAdd'
  | 'sectionAdd'
  | 'sectionRename'
  | 'sectionDelete'
  | 'sectionMove';

export function labelFor(a: EditorAction): ActionLabel | null {
  switch (a.type) {
    case 'rowMove':
    case 'rowAdd':
    case 'rowDelete':
    case 'rowSplit':
    case 'stepAdd':
    case 'stepDelete':
    case 'stepMove':
    case 'stepConvert':
    case 'stepEdit':
    case 'bannerAdd':
    case 'sectionAdd':
    case 'sectionRename':
    case 'sectionDelete':
    case 'sectionMove':
      return a.type;
    case 'rowEditText':
    case 'rowEditField':
      return 'rowEdit';
    case 'stepSetSpan':
    case 'stepGrowStart':
    case 'stepShrinkStart':
    case 'stepGrowEnd':
    case 'stepShrinkEnd':
      return 'stepResize';
    default:
      return null;
  }
}

/** One sentence fragment of an announcement; the component translates it. */
export type AnnouncePart =
  | { id: 'undone' | 'redone'; action: ActionLabel | null }
  | { id: 'nothingToUndo' | 'nothingToRedo' }
  | { id: 'uncoveredNow'; names: string }
  | { id: 'allCovered' };

export type Announcement = { seq: number; parts: AnnouncePart[] };

export type Session = {
  editor: EditorState;
  /** Mirrors `editor.history.past` / `.future`: what each entry did. */
  labels: { past: (ActionLabel | null)[]; future: (ActionLabel | null)[] };
  announcement: Announcement | null;
  seq: number;
  /** True once a save succeeded in this session (T9 dispatches `markSaved`). */
  saved: boolean;
};

export function initSession(recipe: ApiRecipeLike): Session {
  return {
    editor: fromApiRecipe(recipe),
    labels: { past: [], future: [] },
    announcement: null,
    seq: 0,
    saved: false,
  };
}

/** "section:row" keys of rows no column step uses, plus their names, per document. */
function uncovered(d: EditorDoc): { sig: string; names: string[] } {
  const keys: string[] = [];
  const names: string[] = [];
  for (const sec of d.sections) {
    for (const r of uncoveredRows(sec.steps, sec.ingredients.length)) {
      keys.push(`${sec.key}:${sec.ingredients[r].key}`);
      names.push(sec.ingredients[r].name || '...');
    }
  }
  return { sig: keys.join('|'), names };
}

const MAX_NAMES = 3;
function uncoveredPart(before: EditorDoc, after: EditorDoc): AnnouncePart | null {
  const a = uncovered(before);
  const b = uncovered(after);
  if (a.sig === b.sig) return null;
  if (b.names.length === 0) return { id: 'allCovered' };
  const shown = b.names.slice(0, MAX_NAMES).join(', ');
  const more = b.names.length - MAX_NAMES;
  return { id: 'uncoveredNow', names: more > 0 ? `${shown} +${more}` : shown };
}

export function reduceSession(s: Session, action: EditorAction): Session {
  const { editor } = s;

  if (action.type === 'undo' || action.type === 'redo') {
    const isUndo = action.type === 'undo';
    const stack = isUndo ? s.labels.past : s.labels.future;
    if (stack.length === 0 || (isUndo ? editor.history.past : editor.history.future).length === 0) {
      const seq = s.seq + 1;
      return {
        ...s,
        seq,
        announcement: { seq, parts: [{ id: isUndo ? 'nothingToUndo' : 'nothingToRedo' }] },
      };
    }
    const next = reduce(editor, action);
    const label = stack[stack.length - 1];
    const labels = isUndo
      ? { past: s.labels.past.slice(0, -1), future: [...s.labels.future, label] }
      : { past: [...s.labels.past, label], future: s.labels.future.slice(0, -1) };
    const parts: AnnouncePart[] = [{ id: isUndo ? 'undone' : 'redone', action: label }];
    const u = uncoveredPart(doc(editor), doc(next));
    if (u) parts.push(u);
    const seq = s.seq + 1;
    return { ...s, editor: next, labels, seq, announcement: { seq, parts } };
  }

  if (action.type === 'reset') {
    return { ...initSession(action.recipe), seq: s.seq };
  }

  const next = reduce(editor, action);
  if (next === editor) return s;
  const changedDoc = doc(next) !== doc(editor);
  let labels = s.labels;
  let announcement = s.announcement;
  let seq = s.seq;
  if (action.type === 'markSaved') {
    return { ...s, editor: next, saved: true };
  }
  if (changedDoc) {
    const pushed = next.history.past.at(-1) !== editor.history.past.at(-1);
    if (pushed) {
      labels = {
        past: [...s.labels.past, labelFor(action)].slice(-HISTORY_CAP),
        future: [],
      };
    }
    const u = uncoveredPart(doc(editor), doc(next));
    if (u) {
      seq += 1;
      announcement = { seq, parts: [u] };
    }
  }
  return { ...s, editor: next, labels, announcement, seq };
}
