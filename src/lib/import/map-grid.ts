// Auto-mapper (data-model §3, heuristic steps 1-6). Pure, total and bounded: no I/O, no
// regex built from input, no clock, no randomness. All work is counted against an
// operation budget; exceeding it returns `{ mapped: false, reason: 'budget' }`.
// Never throws.

import { validateRecipeGrid } from '@/lib/grid/validate';
import { recipeInputSchema, type IngredientInput, type RecipeInput } from '@/lib/recipes/schemas';
import {
  buildIndex,
  BudgetExceeded,
  findMentions,
  rowKey,
  spend,
  type Budget,
  type Mention,
} from './ingredient-match';
import { computeConfidence } from './map-confidence';
import { assignIngredients, groupSteps } from './map-sections';
import {
  isSplitCandidate,
  markerBefore,
  resolveSplit,
  type Portion,
  type SplitEvent,
} from './map-split';
import {
  MAP_LIMITS,
  type MapInput,
  type MapOptions,
  type MapResult,
  type MapStepInput,
  type MappingSignals,
} from './map-types';
import { Warnings } from './map-warnings';
import { classifyTokens, type StepClass } from './step-verbs';
import { safeSlice, singularize, tokenizeDetailed, type Tokenized } from './text-tokens';

type SectionsOut = RecipeInput['sections'];
type StepOut = SectionsOut[number]['steps'][number];

// -- input coercion -----------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() !== '' ? safeSlice(v.trim(), max) : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000 ? v : null;

function coerceIngredient(v: unknown): IngredientInput | null {
  if (!isObj(v)) return null;
  const name = str(v['name'], MAP_LIMITS.ingredientNameChars);
  if (name === null) return null;
  const range = (lo: number | null, hi: number | null) =>
    lo !== null && hi !== null && hi > lo ? hi : null;
  const mq = num(v['metric_qty']);
  const uq = num(v['us_qty']);
  return {
    name,
    note: str(v['note'], 300),
    raw_text: str(v['raw_text'], 500),
    metric_qty: mq,
    metric_qty_max: range(mq, num(v['metric_qty_max'])),
    metric_unit: str(v['metric_unit'], 20),
    us_qty: uq,
    us_qty_max: range(uq, num(v['us_qty_max'])),
    us_unit: str(v['us_unit'], 20),
    display_primary: v['display_primary'] === 'us' ? 'us' : 'metric',
    split_group_id: str(v['split_group_id'], 64),
    portion_label: str(v['portion_label'], 60),
    group_label: str(v['group_label'], 120),
  };
}

function coerce(
  input: unknown,
  warn: Warnings,
): { ings: IngredientInput[]; steps: MapStepInput[] } {
  const ings: IngredientInput[] = [];
  const steps: MapStepInput[] = [];
  if (!isObj(input)) return { ings, steps };
  const rawIngs = Array.isArray(input['ingredients']) ? (input['ingredients'] as unknown[]) : [];
  const rawSteps = Array.isArray(input['steps']) ? (input['steps'] as unknown[]) : [];
  if (rawIngs.length > MAP_LIMITS.ingredients) warn.add('input_truncated');
  for (const v of rawIngs.slice(0, MAP_LIMITS.ingredients)) {
    const ing = coerceIngredient(v);
    if (ing) ings.push(ing);
  }
  if (rawSteps.length > MAP_LIMITS.steps) warn.add('input_truncated');
  let total = 0;
  for (const v of rawSteps.slice(0, MAP_LIMITS.steps)) {
    const text =
      typeof v === 'string' ? v : isObj(v) && typeof v['text'] === 'string' ? v['text'] : null;
    if (text === null) continue;
    let t = text.trim();
    if (t === '') continue;
    if (t.length > MAP_LIMITS.stepChars) {
      t = safeSlice(t, MAP_LIMITS.stepChars);
      warn.add('input_truncated');
    }
    if (total + t.length > MAP_LIMITS.totalStepChars) {
      warn.add('input_truncated');
      break;
    }
    total += t.length;
    const section = isObj(v) ? str(v['section'], 120) : null;
    steps.push({ text: t, section });
  }
  return { ings, steps };
}

// -- step preparation ---------------------------------------------------------------------

type Prepared = { text: string; tk: Tokenized; words: string[]; cls: StepClass };

function prepare(
  text: string,
  budget: Budget,
  warn: Warnings,
  memo: Map<string, Prepared>,
): Prepared {
  const hit = memo.get(text);
  if (hit) return hit;
  const tk = tokenizeDetailed(text, MAP_LIMITS.tokensPerStep);
  spend(budget, 1 + tk.tokens.length);
  if (tk.truncated) warn.add('input_truncated');
  const p: Prepared = {
    text,
    tk,
    words: tk.tokens.map((t) => singularize(t.w)),
    cls: classifyTokens(text, tk.tokens),
  };
  memo.set(text, p);
  return p;
}

// -- one section --------------------------------------------------------------------------

type Totals = {
  ings: number;
  matched: number;
  mentionEvents: number;
  ambWeight: number;
  columnSteps: number;
  columnVerbs: number;
  splitCandidates: number;
  splitResolved: number;
  groupRefs: number;
  ends: Set<string>;
  splitCounter: number;
};

type Unit = { id: number; portion: Portion | null };

function mapSection(
  title: string | null,
  steps: Prepared[],
  ings: IngredientInput[],
  keepLabel: boolean,
  budget: Budget,
  totals: Totals,
  warn: Warnings,
  sectionIdx: number,
): SectionsOut[number] {
  const n = steps.length;
  const index = buildIndex(
    ings.map((i) => i.name),
    budget,
  );

  // Phase A: mentions without state; decides banners.
  const ments: Mention[][] = steps.map((p) =>
    p.cls.isPrep ? [] : findMentions(p.words, index, budget),
  );
  const seen = new Set<number>();
  const adds: boolean[] = ments.map((ms) => {
    let add = false;
    for (const m of ms) {
      if (m.ambiguous) continue;
      for (const id of m.ids) {
        if (!seen.has(id)) add = true;
        seen.add(id);
      }
    }
    return add;
  });

  let top = ments.findIndex((ms, i) => !steps[i]!.cls.isPrep && ms.length > 0);
  if (top < 0) {
    top = 0;
    while (top < n && steps[top]!.cls.isPrep) top++;
  }
  for (let i = 0; i < top; i++) {
    if (!steps[i]!.cls.isPrep) warn.add('step_without_ingredients');
  }

  // Bottom banners (G19): a trailing run after the last cook step (or last adding step).
  let anchor = -1;
  for (let i = n - 1; i >= top; i--) {
    if (!steps[i]!.cls.isPrep && steps[i]!.cls.hasCook) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) {
    for (let i = n - 1; i >= top; i--) {
      if (adds[i]) {
        anchor = i;
        break;
      }
    }
  }
  if (anchor < 0) anchor = n - 1;
  let bottom = n;
  for (let i = n - 1; i > anchor && i >= top; i--) {
    const c = steps[i]!.cls;
    const qualifies =
      !c.isPrep && (c.leadServe || !adds[i]) && (c.leadFinish || (!c.hasCook && !c.hasCombine));
    if (!qualifies) break;
    bottom = i;
  }
  if (top >= bottom) {
    // A section needs at least one column step (G19).
    if (top >= n) {
      top = n - 1;
      bottom = n;
    } else bottom = top + 1;
  }

  // Phase B: resolve mentions in order, with state (G7).
  const mentioned = new Set<number>();
  const matched = new Set<number>();
  const events: Array<{ id: number; step: number; at: number }> = [];
  let ambWeight = 0;
  let mentionEvents = 0;
  for (let i = top; i < n; i++) {
    const p = steps[i]!;
    for (const m of ments[i]!) {
      // Candidate filtering below is O(ids): charge it (security F1).
      spend(budget, m.ids.length);
      mentionEvents++;
      let id: number | null = null;
      if (!m.ambiguous) {
        id =
          m.ids.length === 1
            ? m.ids[0]!
            : (m.ids.find((x) => !mentioned.has(x)) ?? m.ids[m.ids.length - 1]!);
      } else {
        const open = m.ids.filter((x) => !mentioned.has(x));
        if (open.length === 1) {
          id = open[0]!;
          ambWeight += 0.5;
        } else {
          ambWeight += 1;
          warn.add(`ambiguous_name:${p.tk.tokens[m.at]?.w ?? '?'}`);
        }
      }
      if (id === null) continue;
      mentioned.add(id);
      matched.add(id);
      if (i < bottom) events.push({ id, step: i, at: m.at });
    }
  }

  // Splits (G8).
  const byId = new Map<number, Array<{ step: number; at: number }>>();
  for (const e of events) {
    const list = byId.get(e.id);
    if (list) list.push(e);
    else byId.set(e.id, [e]);
  }
  const splits = new Map<number, Portion[]>();
  for (const [id, evs] of byId) {
    if (new Set(evs.map((e) => e.step)).size < 2) continue;
    spend(budget, evs.length);
    const se: SplitEvent[] = evs.map((e) => ({
      step: e.step,
      marker: markerBefore(steps[e.step]!.tk, e.at),
    }));
    const ing = ings[id]!;
    if (!isSplitCandidate(ing, se)) continue;
    totals.splitCandidates++;
    const res = resolveSplit(ing, se);
    if (res.ok) {
      totals.splitResolved++;
      splits.set(id, res.portions);
    } else warn.add(`split_unresolved:${ing.name}`);
  }
  const unitFor = (id: number, step: number): Unit => {
    const portions = splits.get(id);
    if (!portions) return { id, portion: null };
    let pick = portions[0]!;
    for (const p of portions) if (p.step <= step) pick = p;
    return { id, portion: pick };
  };
  const keyOf = (u: Unit): string =>
    `${u.id}:${u.portion ? (splits.get(u.id) ?? []).indexOf(u.portion) : ''}`;

  // Row order (G3) and spans (G4, G5).
  const order: Unit[] = [];
  const rowKeys = new Set<string>();
  const placedIds = new Set<number>();
  const push = (u: Unit) => {
    const k = keyOf(u);
    if (rowKeys.has(k)) return;
    rowKeys.add(k);
    order.push(u);
    placedIds.add(u.id);
  };
  const evByStep = new Map<number, Array<{ id: number; at: number }>>();
  for (const e of events) {
    const l = evByStep.get(e.step);
    if (l) l.push(e);
    else evByStep.set(e.step, [e]);
  }
  const ends: number[] = [];
  for (let i = top; i < bottom; i++) {
    for (const e of evByStep.get(i) ?? []) push(unitFor(e.id, i));
    const ref = steps[i]!.cls.hasGroupRef;
    if (ref === 'all') {
      for (let id = 0; id < ings.length; id++) {
        if (placedIds.has(id)) continue;
        const portions = splits.get(id);
        if (portions) for (const p of portions) push({ id, portion: p });
        else push({ id, portion: null });
        matched.add(id);
      }
    } else if (ref === 'dry' || ref === 'wet') {
      totals.groupRefs++;
      warn.add('group_reference');
    }
    ends.push(order.length - 1);
  }
  for (let id = 0; id < ings.length; id++) {
    if (placedIds.has(id)) continue;
    warn.add(`ingredient_unmentioned:${ings[id]!.name}`);
    push({ id, portion: null });
  }
  const rows = order.length;

  // Output.
  // One temporary group id per split ingredient (the save path rewrites them to ULIDs).
  const groupIds = new Map<number, string>();
  const outIngs: IngredientInput[] = order.map((u) => {
    const src = ings[u.id]!;
    const base: IngredientInput = { ...src, group_label: keepLabel ? src.group_label : null };
    if (!u.portion) return base;
    let gid = groupIds.get(u.id);
    if (!gid) {
      gid = `split:${safeSlice(rowKey(src.name), 40)}:${totals.splitCounter++}`;
      groupIds.set(u.id, gid);
    }
    return { ...base, ...u.portion.fields, split_group_id: gid, portion_label: u.portion.label };
  });

  const outSteps: StepOut[] = steps.map((p, i): StepOut => {
    const extras: Partial<Pick<StepOut, 'temp_c' | 'temp_f' | 'minutes_min' | 'minutes_max'>> = {};
    if (p.cls.temp.c !== undefined) extras.temp_c = p.cls.temp.c;
    if (p.cls.temp.f !== undefined) extras.temp_f = p.cls.temp.f;
    if (p.cls.minutes.min !== undefined) extras.minutes_min = p.cls.minutes.min;
    if (p.cls.minutes.max !== undefined) extras.minutes_max = p.cls.minutes.max;
    if (p.cls.warnings.includes('time_ambiguous')) warn.add('time_ambiguous');
    if (i < top)
      return {
        kind: 'banner_top',
        label: p.cls.label,
        detail: p.text,
        row_start: null,
        row_end: null,
        ...extras,
      };
    if (i >= bottom)
      return {
        kind: 'banner_bottom',
        label: p.cls.label,
        detail: p.text,
        row_start: null,
        row_end: null,
        ...extras,
      };
    const k = i - top;
    const last = i === bottom - 1;
    let end = ends[k]!;
    if (end < 0 || last) end = rows - 1;
    end = Math.max(end, k > 0 ? (ends[k - 1]! < 0 ? 0 : ends[k - 1]!) : 0);
    end = Math.min(end, rows - 1);
    totals.columnSteps++;
    if (p.cls.verb !== null) totals.columnVerbs++;
    totals.ends.add(`${sectionIdx}:${end}`);
    return {
      kind: 'column',
      label: p.cls.label,
      detail: p.text,
      row_start: 0,
      row_end: end,
      ...extras,
    };
  });

  totals.ings += ings.length;
  totals.matched += matched.size;
  totals.mentionEvents += mentionEvents;
  totals.ambWeight += ambWeight;
  return { title, ingredients: outIngs, steps: outSteps };
}

// -- entry point --------------------------------------------------------------------------

function run(input: unknown, budget: Budget): MapResult {
  const warn = new Warnings();
  const { ings, steps } = coerce(input, warn);
  if (ings.length === 0 || steps.length === 0) {
    return { mapped: false, reason: 'empty', warnings: warn.list() };
  }
  const groups = groupSteps(steps);
  if (groups.length === 0) return { mapped: false, reason: 'empty', warnings: warn.list() };
  if (groups.length > MAP_LIMITS.sections) {
    warn.add('too_many_sections');
    return { mapped: false, reason: 'too_many_sections', warnings: warn.list() };
  }

  const memo = new Map<string, Prepared>();
  let globalIndex: ReturnType<typeof buildIndex> | null = null;
  const mentionedIn = (g: number): ReadonlySet<number> => {
    globalIndex ??= buildIndex(
      ings.map((i) => i.name),
      budget,
    );
    const out = new Set<number>();
    for (const text of groups[g]!.steps) {
      const p = prepare(text, budget, warn, memo);
      if (p.cls.isPrep) continue;
      for (const m of findMentions(p.words, globalIndex, budget))
        for (const id of m.ids) out.add(id);
    }
    return out;
  };
  const assignment = assignIngredients(groups, ings, mentionedIn);
  for (const w of assignment.warnings) warn.add(w);

  const totals: Totals = {
    ings: 0,
    matched: 0,
    mentionEvents: 0,
    ambWeight: 0,
    columnSteps: 0,
    columnVerbs: 0,
    splitCandidates: 0,
    splitResolved: 0,
    groupRefs: 0,
    ends: new Set(),
    splitCounter: 0,
  };
  const keepLabels = assignment.sections.length === 1 && assignment.sections[0]!.title === null;
  const sections: SectionsOut = assignment.sections.map((s, si) =>
    mapSection(
      s.title,
      s.steps.map((t) => prepare(t, budget, warn, memo)),
      s.ingredients.map((i) => ings[i]!),
      keepLabels,
      budget,
      totals,
      warn,
      si,
    ),
  );

  const grid = validateRecipeGrid({ sections });
  const parsed = recipeInputSchema.safeParse({ title: 'Imported recipe', sections });
  if (grid.errors.length > 0 || !parsed.success) {
    warn.add('mapping_invalid');
    return { mapped: false, reason: 'invalid', warnings: warn.list() };
  }

  let secFactor = 1;
  if (warn.has('sections_from_ingredients_only')) secFactor *= 0.65;
  if (warn.has('ingredient_shared_across_sections')) secFactor *= 0.85;
  if (warn.has('section_merged')) secFactor *= 0.7;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const signals: MappingSignals = {
    cov: r3(totals.ings > 0 ? totals.matched / totals.ings : 0),
    unamb: r3(totals.mentionEvents > 0 ? 1 - totals.ambWeight / totals.mentionEvents : 1),
    verbs: r3(totals.columnSteps > 0 ? totals.columnVerbs / totals.columnSteps : 0),
    splitOk: r3(totals.splitCandidates > 0 ? totals.splitResolved / totals.splitCandidates : 1),
    secFactor: Math.max(0.5, secFactor),
    groupRefs: totals.groupRefs,
    columnSteps: totals.columnSteps,
    distinctSpans: new Set([...totals.ends].map((e) => e.split(':')[1])).size,
  };
  const { confidence, level } = computeConfidence(signals, 0);
  return {
    mapped: true,
    proposal: {
      confidence,
      level,
      sections: parsed.data.sections,
      warnings: warn.list(),
      signals,
      version: 1,
    },
  };
}

/** Map imported ingredients and steps to a grid proposal. Total: never throws. */
export function mapGrid(input: MapInput, opts?: MapOptions): MapResult {
  // A caller can lower the budget but never raise it above the default (security F6).
  const limit =
    typeof opts?.budget === 'number' && Number.isFinite(opts.budget) && opts.budget > 0
      ? Math.min(MAP_LIMITS.budget, Math.floor(opts.budget))
      : MAP_LIMITS.budget;
  const budget: Budget = { used: 0, limit };
  try {
    return run(input, budget);
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      return { mapped: false, reason: 'budget', warnings: ['mapping_budget'] };
    }
    return { mapped: false, reason: 'error', warnings: [] };
  } finally {
    try {
      opts?.onUsed?.(budget.used);
    } catch {
      // a faulty observer must not break the total contract
    }
  }
}
