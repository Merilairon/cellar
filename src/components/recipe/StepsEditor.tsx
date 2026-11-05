import { useTranslations } from 'next-intl';
import { emptyStep, type FormStep } from '@/lib/recipes/form-model';
import type { StepKind } from '@/lib/recipes/schemas';
import { FormField, fieldId } from './FormField';
import { btn, btnDanger, input } from './styles';

type Props = {
  /** Section index: error paths are sections.<si>.steps.<ti>.<field>. */
  si: number;
  steps: FormStep[];
  rowCount: number;
  errors: Map<string, string>;
  onChange: (steps: FormStep[]) => void;
};

export function StepsEditor({ si, steps, rowCount, errors, onChange }: Props) {
  const t = useTranslations();
  const patch = (ti: number, p: Partial<FormStep>) =>
    onChange(steps.map((s, i) => (i === ti ? { ...s, ...p } : s)));
  const move = (ti: number, d: -1 | 1) => {
    const next = [...steps];
    [next[ti], next[ti + d]] = [next[ti + d], next[ti]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {steps.map((s, ti) => {
        const path = (f: string) => `sections.${si}.steps.${ti}.${f}`;
        const id = (f: string) => fieldId(path(f));
        const isColumn = s.kind === 'column';
        const text = (f: keyof FormStep & string, field: string, labelKey: string) => (
          <FormField id={id(field)} label={t(labelKey)} code={errors.get(path(field))}>
            {(p) => (
              <input
                {...p}
                value={s[f]}
                onChange={(e) => patch(ti, { [f]: e.target.value })}
                className={input}
              />
            )}
          </FormField>
        );
        const numeric = (
          f: keyof FormStep & string,
          field: string,
          labelKey: string,
          opts: { disabled?: boolean; max?: number } = {},
        ) => (
          <FormField id={id(field)} label={t(labelKey)} code={errors.get(path(field))}>
            {(p) => (
              <input
                {...p}
                type="number"
                inputMode="numeric"
                min={opts.max ? 1 : 0}
                max={opts.max}
                disabled={opts.disabled}
                value={s[f]}
                onChange={(e) => patch(ti, { [f]: e.target.value })}
                className={`${input} disabled:opacity-50`}
              />
            )}
          </FormField>
        );
        return (
          <fieldset
            key={s.key}
            className="rounded border border-neutral-400 p-3 dark:border-neutral-600"
          >
            <legend className="px-1 font-semibold">
              {t('recipe.form.stepLegend', { n: ti + 1 })}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id={id('kind')} label={t('recipe.form.step.kind')}>
                {(p) => (
                  <select
                    {...p}
                    value={s.kind}
                    onChange={(e) => {
                      const kind = e.target.value as StepKind;
                      patch(ti, kind === 'column' ? { kind } : { kind, rowStart: '', rowEnd: '' });
                    }}
                    className={input}
                  >
                    <option value="banner_top">{t('recipe.form.step.bannerTop')}</option>
                    <option value="column">{t('recipe.form.step.column')}</option>
                    <option value="banner_bottom">{t('recipe.form.step.bannerBottom')}</option>
                  </select>
                )}
              </FormField>
              {text('label', 'label', 'recipe.form.step.label')}
              <FormField
                id={id('detail')}
                label={t('recipe.form.step.detail')}
                code={errors.get(path('detail'))}
                className="sm:col-span-2"
              >
                {(p) => (
                  <textarea
                    {...p}
                    rows={2}
                    value={s.detail}
                    onChange={(e) => patch(ti, { detail: e.target.value })}
                    className={input}
                  />
                )}
              </FormField>
              {numeric('rowStart', 'row_start', 'recipe.form.step.rowStart', {
                disabled: !isColumn,
                max: Math.max(rowCount, 1),
              })}
              {numeric('rowEnd', 'row_end', 'recipe.form.step.rowEnd', {
                disabled: !isColumn,
                max: Math.max(rowCount, 1),
              })}
              {numeric('tempF', 'temp_f', 'recipe.form.step.tempF')}
              {numeric('tempC', 'temp_c', 'recipe.form.step.tempC')}
              {numeric('minutesMin', 'minutes_min', 'recipe.form.step.minutesMin')}
              {numeric('minutesMax', 'minutes_max', 'recipe.form.step.minutesMax')}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={btn}
                disabled={ti === 0}
                onClick={() => move(ti, -1)}
              >
                {t('recipe.form.moveUp')}
              </button>
              <button
                type="button"
                className={btn}
                disabled={ti === steps.length - 1}
                onClick={() => move(ti, 1)}
              >
                {t('recipe.form.moveDown')}
              </button>
              <button
                type="button"
                className={btnDanger}
                onClick={() => onChange(steps.filter((_, i) => i !== ti))}
              >
                {t('recipe.form.removeStep')}
              </button>
            </div>
          </fieldset>
        );
      })}
      <div>
        <button type="button" className={btn} onClick={() => onChange([...steps, emptyStep()])}>
          {t('recipe.form.addStep')}
        </button>
      </div>
    </div>
  );
}
