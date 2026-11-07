'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  emptyForm,
  emptySection,
  errorMap,
  errorMessageKey,
  ingredientLines,
  validateForm,
  type FormSection,
  type FormState,
} from '@/lib/recipes/form-model';
import type { FieldError as ApiFieldError, Visibility } from '@/lib/recipes/schemas';
import { call } from './api';
import { FormField, fieldId } from './FormField';
import { IngredientTextarea } from './IngredientTextarea';
import { StepsEditor } from './StepsEditor';
import { TagInput } from './TagInput';
import { btn, btnDanger, btnPrimary, input } from './styles';

const TOP_LABELS: Record<string, string> = {
  title: 'recipe.form.title',
  description: 'recipe.form.description',
  servings: 'recipe.form.servings',
  servings_label: 'recipe.form.servingsLabel',
  prep_minutes: 'recipe.form.prepMinutes',
  cook_minutes: 'recipe.form.cookMinutes',
  source_name: 'recipe.form.sourceName',
  source_url: 'recipe.form.sourceUrl',
  visibility: 'recipe.form.visibility',
  tags: 'recipe.form.tags',
  sections: 'recipe.form.sections',
};
const STEP_LABELS: Record<string, string> = {
  label: 'recipe.form.step.label',
  detail: 'recipe.form.step.detail',
  row_start: 'recipe.form.step.rowStart',
  row_end: 'recipe.form.step.rowEnd',
  temp_c: 'recipe.form.step.tempC',
  temp_f: 'recipe.form.step.tempF',
  minutes_min: 'recipe.form.step.minutesMin',
  minutes_max: 'recipe.form.step.minutesMax',
};

/** Lets another screen (the import review) reuse this form with its own endpoint and chrome. */
export type FormTarget = {
  url: string;
  method: string;
  /** Merged into the payload, e.g. { import_cover }. */
  extra?: Record<string, unknown>;
  /** Where to go after a successful save. */
  redirect: (res: { id: string; warnings?: string[] }) => string;
  saveLabel: string;
  failedText: string;
  cancelLabel: string;
  onCancel: () => void;
  /** Called when the server rejects the payload with field errors (422). */
  onInvalid?: () => void;
};

export function RecipeForm({
  recipeId,
  initial,
  target,
  header,
  onChange,
}: {
  recipeId?: string;
  initial?: FormState;
  target?: FormTarget;
  header?: ReactNode;
  /** Reports every form state, including the first (used by the import review preview). Keep it referentially stable. */
  onChange?: (form: FormState) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initial ?? emptyForm());
  const [errors, setErrors] = useState<ApiFieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const errs = errorMap(errors);
  useEffect(() => {
    onChange?.(form);
  }, [form, onChange]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const patchSection = (si: number, p: Partial<FormSection>) =>
    setForm((f) => ({ ...f, sections: f.sections.map((s, i) => (i === si ? { ...s, ...p } : s)) }));

  /** Where an API error path lives in the DOM, and a label for the summary. */
  function locate(e: ApiFieldError): { id: string; label: string } {
    const m = /^sections\.(\d+)\.(title|ingredients|steps)(?:\.(\d+))?(?:\.(\w+))?/.exec(e.path);
    if (m) {
      const si = Number(m[1]);
      if (m[2] === 'title')
        return { id: fieldId(e.path), label: t('recipe.form.sectionTitle', { n: si + 1 }) };
      if (m[2] === 'ingredients')
        return { id: fieldId(`sections.${si}.ingredients`), label: t('recipe.form.ingredients') };
      const field = m[4] ?? 'label';
      return {
        id: fieldId(e.path),
        label: `${t('recipe.form.stepLegend', { n: Number(m[3]) + 1 })}: ${t(STEP_LABELS[field] ?? 'recipe.form.step.label')}`,
      };
    }
    const top = e.path.split('.')[0];
    return { id: fieldId(top), label: t(TOP_LABELS[top] ?? 'recipe.form.title') };
  }

  function fail(list: ApiFieldError[]) {
    setErrors(list);
    // Next frame: the summary has rendered; move focus there so the problem is announced.
    requestAnimationFrame(() => summary.current?.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailed(false);
    const v = validateForm(form);
    if (!v.ok) return fail(v.errors);
    setErrors([]);
    setSubmitting(true);
    const res = target
      ? await call(target.url, target.method, { ...v.payload, ...target.extra })
      : await call(
          recipeId ? `/api/recipes/${recipeId}` : '/api/recipes',
          recipeId ? 'PUT' : 'POST',
          v.payload,
        );
    setSubmitting(false);
    if (res?.ok) {
      const saved = (await res.json()) as { id: string; warnings?: string[] };
      router.push(target ? target.redirect(saved) : `/recipes/${saved.id}`);
      router.refresh();
    } else if (res?.status === 422) {
      target?.onInvalid?.();
      fail(((await res.json()) as { errors: ApiFieldError[] }).errors);
    } else {
      setFailed(true);
    }
  }

  const text = (
    field: keyof FormState & string,
    path: string,
    labelKey: string,
    extra: { type?: string; className?: string } = {},
  ) => (
    <FormField
      id={fieldId(path)}
      label={t(labelKey)}
      code={errs.get(path)}
      className={extra.className}
    >
      {(p) => (
        <input
          {...p}
          type={extra.type ?? 'text'}
          inputMode={extra.type === 'number' ? 'decimal' : undefined}
          step={extra.type === 'number' ? 'any' : undefined}
          value={form[field] as string}
          onChange={(e) => set(field, e.target.value as never)}
          className={input}
        />
      )}
    </FormField>
  );

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-4">
      {header}
      {(errors.length > 0 || failed) && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300"
        >
          {failed ? (
            <p>{target?.failedText ?? t('recipe.errors.saveFailed')}</p>
          ) : (
            <>
              <p className="font-semibold">
                {t('recipe.form.errorSummary', { count: errors.length })}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {errors.map((e, i) => {
                  const loc = locate(e);
                  return (
                    <li key={i}>
                      <a href={`#${loc.id}`} className="underline">
                        {loc.label}
                      </a>
                      : {t(errorMessageKey(e.code))}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {text('title', 'title', 'recipe.form.title')}
      <FormField
        id={fieldId('description')}
        label={t('recipe.form.description')}
        code={errs.get('description')}
      >
        {(p) => (
          <textarea
            {...p}
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className={input}
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('servings', 'servings', 'recipe.form.servings', { type: 'number' })}
        {text('servingsLabel', 'servings_label', 'recipe.form.servingsLabel')}
        {text('prepMinutes', 'prep_minutes', 'recipe.form.prepMinutes', { type: 'number' })}
        {text('cookMinutes', 'cook_minutes', 'recipe.form.cookMinutes', { type: 'number' })}
        {text('sourceName', 'source_name', 'recipe.form.sourceName')}
        {text('sourceUrl', 'source_url', 'recipe.form.sourceUrl', { type: 'url' })}
      </div>
      <FormField id={fieldId('visibility')} label={t('recipe.form.visibility')}>
        {(p) => (
          <select
            {...p}
            value={form.visibility}
            onChange={(e) => set('visibility', e.target.value as Visibility)}
            className={input}
          >
            <option value="private">{t('recipe.visibility.private')}</option>
            <option value="users">{t('recipe.visibility.users')}</option>
          </select>
        )}
      </FormField>

      <FormField id={fieldId('tags')} label={t('recipe.form.tags')} code={errs.get('tags')}>
        {(p) => (
          <TagInput
            id={p.id}
            tags={form.tags}
            onChange={(tags) => set('tags', tags)}
            describedBy={p['aria-describedby']}
            invalid={p['aria-invalid']}
          />
        )}
      </FormField>

      {form.sections.map((s, si) => {
        const ingErr = errors.find((e) => e.path.startsWith(`sections.${si}.ingredients`));
        return (
          <section
            key={s.key}
            aria-labelledby={`sec-${s.key}`}
            className="flex flex-col gap-4 rounded border border-neutral-400 p-4 dark:border-neutral-600"
          >
            <h2 id={`sec-${s.key}`} className="text-lg font-semibold">
              {t('recipe.form.sectionHeading', { n: si + 1 })}
            </h2>
            <FormField
              id={fieldId(`sections.${si}.title`)}
              label={t('recipe.form.sectionTitle', { n: si + 1 })}
              code={errs.get(`sections.${si}.title`)}
            >
              {(p) => (
                <input
                  {...p}
                  value={s.title}
                  onChange={(e) => patchSection(si, { title: e.target.value })}
                  className={input}
                />
              )}
            </FormField>
            <IngredientTextarea
              id={fieldId(`sections.${si}.ingredients`)}
              value={s.ingredientsText}
              onChange={(v) => patchSection(si, { ingredientsText: v })}
              code={ingErr?.code}
            />
            <h3 className="font-semibold">{t('recipe.form.steps')}</h3>
            <p className="-mt-3 text-sm text-neutral-700 dark:text-neutral-300">
              {t('recipe.form.stepsHint')}
            </p>
            <StepsEditor
              si={si}
              steps={s.steps}
              rowCount={ingredientLines(s.ingredientsText).length}
              errors={errs}
              onChange={(steps) => patchSection(si, { steps })}
            />
            {form.sections.length > 1 && (
              <div>
                <button
                  type="button"
                  className={btnDanger}
                  onClick={() =>
                    set(
                      'sections',
                      form.sections.filter((_, i) => i !== si),
                    )
                  }
                >
                  {t('recipe.form.removeSection')}
                </button>
              </div>
            )}
          </section>
        );
      })}
      <div>
        <button
          type="button"
          className={btn}
          onClick={() => set('sections', [...form.sections, emptySection()])}
        >
          {t('recipe.form.addSection')}
        </button>
      </div>

      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={submitting}>
          {target?.saveLabel ?? t('recipe.form.save')}
        </button>
        <button type="button" className={btn} onClick={target?.onCancel ?? (() => router.back())}>
          {target?.cancelLabel ?? t('recipe.actions.cancel')}
        </button>
      </div>
    </form>
  );
}
