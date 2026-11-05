'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { validateSection } from '@/lib/grid/validate';
import { errorMap, recipePayloadWithSpans } from '@/lib/recipes/form-model';
import type { FieldError as ApiFieldError } from '@/lib/recipes/schemas';
import { call } from './api';
import { FieldError } from './FieldError';
import { btn, btnPrimary, input } from './styles';
import type { ApiRecipe } from './types';

type Spans = Record<string, { start: string; end: string }>;

const sortByPos = <T extends { position: number }>(xs: T[]) =>
  [...xs].sort((a, b) => a.position - b.position);

/** Minimal span editor for list recipes: number inputs only, 1-based, validated live. */
export function ConvertToGrid({
  recipe,
  onConverted,
}: {
  recipe: ApiRecipe;
  onConverted: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);
  const [failed, setFailed] = useState(false);
  const [spans, setSpans] = useState<Spans>(() => {
    const init: Spans = {};
    for (const s of recipe.sections)
      for (const st of s.steps)
        if (st.kind === 'column')
          init[st.id] = {
            start: st.row_start == null ? '' : String(st.row_start + 1),
            end: st.row_end == null ? '' : String(st.row_end + 1),
          };
    return init;
  });

  const toInt = (v: string): number | null => (v.trim() === '' ? null : Number(v) - 1);

  // Live validation with the same function the server uses.
  const liveErrors: ApiFieldError[] = recipe.sections.flatMap(
    (sec, si) =>
      validateSection(
        {
          ingredients: sec.ingredients,
          steps: sortByPos(sec.steps).map((st) =>
            st.kind === 'column'
              ? {
                  kind: 'column' as const,
                  row_start: toInt(spans[st.id]?.start ?? ''),
                  row_end: toInt(spans[st.id]?.end ?? ''),
                }
              : { kind: st.kind },
          ),
        },
        `sections.${si}.`,
      ).errors,
  );
  const errors = errorMap([...serverErrors, ...liveErrors]);

  async function save() {
    setAttempted(true);
    setFailed(false);
    if (liveErrors.length) return;
    const map = new Map<string, [number, number]>();
    for (const [id, v] of Object.entries(spans))
      map.set(id, [Number(v.start) - 1, Number(v.end) - 1]);
    setSaving(true);
    const res = await call(
      `/api/recipes/${recipe.id}`,
      'PUT',
      recipePayloadWithSpans(recipe, map, 'grid'),
    );
    setSaving(false);
    if (res?.ok) {
      setServerErrors([]);
      onConverted();
      setOpen(false);
      router.refresh();
    } else if (res?.status === 422) {
      setServerErrors(((await res.json()) as { errors: ApiFieldError[] }).errors);
    } else {
      setFailed(true);
    }
  }

  if (!open) {
    return (
      <div className="mb-4">
        <button type="button" className={btnPrimary} onClick={() => setOpen(true)}>
          {t('recipe.convert.open')}
        </button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={`${uid}-h`}
      className="mb-4 rounded border border-neutral-400 p-4 dark:border-neutral-600"
    >
      <h2 id={`${uid}-h`} className="text-lg font-semibold">
        {t('recipe.convert.title')}
      </h2>
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        {t('recipe.convert.help')}
      </p>
      {recipe.sections.map((sec, si) => {
        const cols = sortByPos(sec.steps).filter((s) => s.kind === 'column');
        const rows = sortByPos(sec.ingredients);
        return (
          <div key={sec.id} className="mt-4">
            {recipe.sections.length > 1 && (
              <h3 className="font-semibold">{sec.title || t('recipe.section', { n: si + 1 })}</h3>
            )}
            <ol className="mt-1 list-decimal pl-6 text-sm">
              {rows.map((r) => (
                <li key={r.id}>{r.name}</li>
              ))}
            </ol>
            <div className="mt-3 flex flex-col gap-3">
              {cols.map((st, n) => {
                const ti = sortByPos(sec.steps).findIndex((x) => x.id === st.id);
                const base = `sections.${si}.steps.${ti}`;
                const v = spans[st.id] ?? { start: '', end: '' };
                const field = (which: 'start' | 'end', path: string) => {
                  const code = errors.get(path);
                  const show = code && (attempted || v[which] !== '' || serverErrors.length > 0);
                  const id = `${uid}-${st.id}-${which}`;
                  return (
                    <div className="flex-1">
                      <label htmlFor={id} className="block text-sm">
                        {t(
                          which === 'start' ? 'recipe.convert.firstRow' : 'recipe.convert.lastRow',
                        )}
                      </label>
                      <input
                        id={id}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={rows.length}
                        value={v[which]}
                        aria-invalid={show ? true : undefined}
                        aria-describedby={show ? `${id}-err` : undefined}
                        onChange={(e) =>
                          setSpans((p) => ({ ...p, [st.id]: { ...v, [which]: e.target.value } }))
                        }
                        className={input}
                      />
                      {show && <FieldError id={`${id}-err`} code={code} />}
                    </div>
                  );
                };
                return (
                  <fieldset
                    key={st.id}
                    className="rounded border border-neutral-300 p-3 dark:border-neutral-700"
                  >
                    <legend className="px-1 text-sm font-semibold">
                      {t('recipe.grid.stepHeader', { n: n + 1, label: st.label })}
                    </legend>
                    <div className="flex gap-3">
                      {field('start', `${base}.row_start`)}
                      {field('end', `${base}.row_end`)}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </div>
        );
      })}
      {failed && (
        <p role="alert" className="mt-3 text-red-700 dark:text-red-400">
          {t('recipe.errors.saveFailed')}
        </p>
      )}
      {attempted && liveErrors.length > 0 && (
        <p role="alert" className="mt-3 text-red-700 dark:text-red-400">
          {t('recipe.convert.fix')}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className={btnPrimary} disabled={saving} onClick={save}>
          {t('recipe.convert.save')}
        </button>
        <button type="button" className={btn} onClick={() => setOpen(false)}>
          {t('recipe.actions.cancel')}
        </button>
      </div>
    </section>
  );
}
