// Roving-tabindex model for one section table (UX spec 14.2). Pure: targets in, target out.
// Every section table has exactly one tab stop; arrow keys walk the rest.

import { buildSectionLayout } from '@/lib/grid/layout';
import type { EditorSection } from '@/lib/grid/editor';

export type RovingTarget =
  | { id: string; kind: 'row'; index: number; key: string }
  | {
      id: string;
      kind: 'step';
      col: number;
      rowStart: number;
      rowEnd: number;
      key: string;
    }
  | { id: string; kind: 'banner'; group: 'top' | 'bottom'; index: number; key: string };

export const rowId = (key: string) => `row:${key}`;
export const stepId = (key: string) => `step:${key}`;
export const bannerId = (key: string) => `banner:${key}`;

/** Targets in reading order: top banners, rows, bottom banners, then the step cells. */
export function targetsFor(section: EditorSection): RovingTarget[] {
  const layout = buildSectionLayout(section.ingredients.length, section.steps);
  const out: RovingTarget[] = [];
  layout.bannersTop.forEach((s, index) =>
    out.push({ id: bannerId(s.key), kind: 'banner', group: 'top', index, key: s.key }),
  );
  section.ingredients.forEach((r, index) =>
    out.push({ id: rowId(r.key), kind: 'row', index, key: r.key }),
  );
  layout.bannersBottom.forEach((s, index) =>
    out.push({ id: bannerId(s.key), kind: 'banner', group: 'bottom', index, key: s.key }),
  );
  for (const c of layout.columns)
    out.push({
      id: stepId(c.step.key),
      kind: 'step',
      col: c.columnIndex,
      rowStart: c.rowStart,
      rowEnd: c.rowEnd,
      key: c.step.key,
    });
  return out;
}

/** The target that holds tabindex 0 when the remembered one is missing or unset. */
export function defaultTarget(targets: RovingTarget[]): string | null {
  return (
    (
      targets.find((t) => t.kind === 'row') ??
      targets.find((t) => t.kind === 'banner') ??
      targets[0]
    )?.id ?? null
  );
}

export type NavKey =
  'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'PageUp' | 'PageDown';

export const NAV_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
];

export type NavResult = { type: 'focus'; id: string } | { type: 'section'; dir: 1 | -1 } | null;

/**
 * Where a navigation key leads from `currentId`. Plain arrows and Home/End only: chords with
 * Alt or Shift are actions (T5 to T7), not navigation, and must not reach this function.
 * `null` means the key is consumed but nothing moves (a limit).
 */
export function navigate(
  targets: RovingTarget[],
  currentId: string,
  key: NavKey,
  ctrl = false,
): NavResult {
  const cur = targets.find((t) => t.id === currentId);
  if (!cur) return null;
  if (key === 'PageDown') return { type: 'section', dir: 1 };
  if (key === 'PageUp') return { type: 'section', dir: -1 };

  const rows = targets.filter((t) => t.kind === 'row');
  const steps = targets
    .filter((t) => t.kind === 'step')
    .sort((a, b) => (a.kind === 'step' && b.kind === 'step' ? a.col - b.col : 0));
  const top = targets.filter((t) => t.kind === 'banner' && t.group === 'top');
  const bottom = targets.filter((t) => t.kind === 'banner' && t.group === 'bottom');
  const focus = (t: RovingTarget | undefined): NavResult =>
    t ? { type: 'focus', id: t.id } : null;

  if (ctrl && (key === 'Home' || key === 'End')) {
    const order = [...top, ...rows, ...bottom];
    return focus(key === 'Home' ? order[0] : order[order.length - 1]);
  }

  const covers = (s: RovingTarget, r: number) =>
    s.kind === 'step' && s.rowStart <= r && r <= s.rowEnd;

  if (cur.kind === 'row') {
    switch (key) {
      case 'ArrowDown':
        return focus(rows[cur.index + 1] ?? bottom[0]);
      case 'ArrowUp':
        return focus(rows[cur.index - 1] ?? top[top.length - 1]);
      case 'ArrowRight':
        return focus(steps.find((s) => covers(s, cur.index)));
      case 'Home':
        return focus(rows[0]);
      case 'End':
        return focus(rows[rows.length - 1]);
      default:
        return null;
    }
  }

  if (cur.kind === 'step') {
    const first = cur.rowStart;
    switch (key) {
      case 'ArrowRight':
        return focus(steps.find((s) => s.kind === 'step' && s.col > cur.col && covers(s, first)));
      case 'ArrowLeft': {
        const prev = [...steps]
          .reverse()
          .find((s) => s.kind === 'step' && s.col < cur.col && covers(s, first));
        return focus(prev ?? rows[first]);
      }
      case 'Home':
        return focus(steps[0]);
      case 'End':
        return focus(steps[steps.length - 1]);
      default:
        return null; // each step owns its column, so Up and Down have no neighbour
    }
  }

  // banner
  const group = cur.group === 'top' ? top : bottom;
  switch (key) {
    case 'ArrowDown':
      if (cur.index + 1 < group.length) return focus(group[cur.index + 1]);
      return cur.group === 'top' ? focus(rows[0]) : null;
    case 'ArrowUp':
      if (cur.index > 0) return focus(group[cur.index - 1]);
      return cur.group === 'bottom' ? focus(rows[rows.length - 1]) : null;
    case 'Home':
      return focus(group[0]);
    case 'End':
      return focus(group[group.length - 1]);
    default:
      return null;
  }
}
