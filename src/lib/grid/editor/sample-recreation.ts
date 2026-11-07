// Test-only: turns a stored section into the reducer actions a user would perform on an
// empty section (rows, then banners, then column steps with explicit spans).
import { sectionInputSchema } from '@/lib/recipes/schemas';
import type { EditorAction } from './reducer';
import { docToPayloadSections, fromApiRecipe, type GridPayload } from './state';

type SampleSection = {
  ingredients: Record<string, unknown>[];
  steps: Record<string, unknown>[];
};

export function recreateSection(sec: SampleSection, section: number): EditorAction[] {
  const actions: EditorAction[] = [];
  const patchOf = (i: Record<string, unknown>) => {
    const { split_group_id: _g, portion_label: _p, ...rest } = i;
    void _g;
    void _p;
    return rest as never;
  };
  // Rows; a split group is made by adding the ingredient once, splitting, and moving the portion.
  const done = new Set<number>();
  const order: number[] = [];
  sec.ingredients.forEach((i, idx) => {
    if (done.has(idx)) return;
    if (i.split_group_id) {
      const mate = sec.ingredients.findIndex(
        (o, j) => j > idx && o.split_group_id === i.split_group_id,
      );
      done.add(mate);
      order.push(idx);
      actions.push({ type: 'rowAdd', section, ingredient: patchOf(i) });
      actions.push({ type: 'rowSplit', section, row: order.length - 1 });
      order.push(mate);
      // Pin both portions to the stored text and labels.
      actions.push({ type: 'rowEditText', section, row: order.length - 2, patch: patchOf(i) });
      actions.push({
        type: 'rowEditText',
        section,
        row: order.length - 1,
        patch: patchOf(sec.ingredients[mate]),
      });
      actions.push({
        type: 'rowEditField',
        section,
        row: order.length - 2,
        field: 'portion_label',
        value: i.portion_label as string,
      });
      actions.push({
        type: 'rowEditField',
        section,
        row: order.length - 1,
        field: 'portion_label',
        value: sec.ingredients[mate].portion_label as string,
      });
    } else {
      order.push(idx);
      actions.push({ type: 'rowAdd', section, ingredient: patchOf(i) });
    }
  });
  // Move rows into their stored order (selection sort over the current arrangement).
  const current = order.slice();
  for (let target = 0; target < sec.ingredients.length; target++) {
    const from = current.indexOf(target);
    if (from !== target) {
      actions.push({ type: 'rowMove', section, from, to: target });
      current.splice(from, 1);
      current.splice(target, 0, target);
    }
  }
  const stepPatch = (t: Record<string, unknown>) => ({
    label: t.label as string,
    detail: (t.detail as string) ?? '',
    temp_c: (t.temp_c as number) ?? null,
    temp_f: (t.temp_f as number) ?? null,
    minutes_min: (t.minutes_min as number) ?? null,
    minutes_max: (t.minutes_max as number) ?? null,
  });
  let cols = 0;
  for (const t of sec.steps) {
    if (t.kind === 'column') {
      actions.push({ type: 'stepAdd', section, step: stepPatch(t) });
      actions.push({
        type: 'stepSetSpan',
        section,
        step: sec.steps.filter((x) => x.kind === 'banner_top').length + cols,
        start: t.row_start as number,
        end: t.row_end as number,
      });
      cols++;
    } else {
      actions.push({
        type: 'bannerAdd',
        section,
        kind: t.kind as 'banner_top' | 'banner_bottom',
        step: stepPatch(t),
      });
    }
  }
  return actions;
}

/** Check a payload against the API's section schema; returns zod issue paths (empty = accepted). */
export function gridPayloadSchemaCheck(p: GridPayload): string[] {
  const out: string[] = [];
  p.sections.forEach((s, i) => {
    const r = sectionInputSchema.safeParse(s);
    if (!r.success) out.push(...r.error.issues.map((x) => `${i}.${x.path.join('.')}`));
  });
  if (p.sections.length < 1 || p.sections.length > 20) out.push('sections');
  return out;
}

export { docToPayloadSections, fromApiRecipe };
