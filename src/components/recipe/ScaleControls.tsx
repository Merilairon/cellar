'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MAX_FACTOR } from '@/lib/units/scale';
import { formatQty } from '@/lib/units/display';
import type { UnitSystem } from '@/lib/units/units';
import type { QuantityDisplay } from './IngredientCell';
import { btn, input } from './styles';
import {
  customFactorFor,
  enterCustom,
  parseCustomAmount,
  summaryKind,
  typeCustom,
} from './scale-input';

type Preset = 'half' | 'one' | 'two' | 'custom';
const PRESET_FACTOR: Record<Exclude<Preset, 'custom'>, number> = { half: 0.5, one: 1, two: 2 };

export { parseCustomAmount };

/** View state only: nothing here is persisted, so a reload goes back to the user's preference. */
export function useScale(pref: UnitSystem, servings: number | null) {
  const [preset, setPreset] = useState<Preset>('one');
  const [custom, setCustom] = useState({ text: '', factor: 1 });
  const [toggle, setToggle] = useState<UnitSystem | null>(null);

  const factor = preset === 'custom' ? custom.factor : PRESET_FACTOR[preset];
  const primary: UnitSystem = toggle ?? pref;
  const display = useMemo<QuantityDisplay>(
    () => ({ pref, scale: factor, toggle }),
    [pref, factor, toggle],
  );
  const customError =
    preset === 'custom' && custom.text !== '' && customFactorFor(custom.text, servings) === null;

  return {
    display,
    factor,
    preset,
    customText: custom.text,
    customError,
    primary,
    changed: factor !== 1 || toggle !== null,
    choose: (p: Preset) => {
      if (p === 'custom' && preset !== 'custom') setCustom(enterCustom(factor));
      setPreset(p);
    },
    setCustom: (text: string) => setCustom((prev) => typeCustom(prev, text, servings)),
    flip: () => setToggle(primary === 'metric' ? 'us' : 'metric'),
    reset: () => {
      setPreset('one');
      setCustom({ text: '', factor: 1 });
      setToggle(null);
    },
  };
}

export type ScaleState = ReturnType<typeof useScale>;

const seg =
  'inline-flex min-h-11 min-w-11 items-center justify-center border-r border-neutral-500 px-4 last:border-r-0 aria-pressed:bg-emerald-700 aria-pressed:text-white';

export function ScaleControls({
  scale: s,
  servings,
}: {
  scale: ScaleState;
  servings: number | null;
}) {
  const t = useTranslations();
  const customId = useId();
  const errId = useId();
  const factorText = formatQty(s.factor);
  const scaledServings = servings != null ? Math.round(servings * s.factor * 100) / 100 : null;

  const kind = summaryKind({
    factor: s.factor,
    customError: s.customError,
    servings,
  });
  let summary: string;
  if (kind === 'invalid') summary = t('recipe.scale.summaryInvalid', { factor: factorText });
  else if (kind === 'original') summary = t('recipe.scale.summaryOriginal');
  else if (kind === 'servings')
    summary = t('recipe.scale.summaryServings', {
      factor: factorText,
      servings: Number.isInteger(scaledServings)
        ? String(scaledServings)
        : `≈ ${formatQty(scaledServings ?? 0)}`,
    });
  else summary = t('recipe.scale.summaryFactor', { factor: factorText });
  if (s.display.toggle !== null && kind !== 'invalid')
    summary += ` ${t('recipe.scale.summaryUnits', { system: s.display.toggle })}`;

  const preset = (p: Exclude<typeof s.preset, 'custom'>, label: string) => (
    <button type="button" className={seg} aria-pressed={s.preset === p} onClick={() => s.choose(p)}>
      {label}
    </button>
  );

  return (
    <section aria-label={t('recipe.scale.label')} className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={t('recipe.scale.group')}
          className="inline-flex overflow-hidden rounded border border-neutral-500"
        >
          {preset('half', t('recipe.scale.half'))}
          {preset('one', t('recipe.scale.one'))}
          {preset('two', t('recipe.scale.two'))}
          <button
            type="button"
            className={seg}
            aria-pressed={s.preset === 'custom'}
            onClick={() => s.choose('custom')}
          >
            {t('recipe.scale.custom')}
          </button>
        </div>
        {s.preset === 'custom' && (
          <div className="flex items-center gap-2">
            <label htmlFor={customId}>
              {servings != null ? t('recipe.scale.servingsTarget') : t('recipe.scale.multiplier')}
            </label>
            <input
              id={customId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={s.customText}
              onChange={(e) => s.setCustom(e.target.value)}
              aria-invalid={s.customError}
              aria-describedby={s.customError ? errId : undefined}
              className={`${input} min-h-11 w-24`}
            />
          </div>
        )}
        <button type="button" className={btn} onClick={s.flip}>
          {s.primary === 'metric' ? t('recipe.scale.toUs') : t('recipe.scale.toMetric')}
        </button>
        <button type="button" className={btn} onClick={s.reset} disabled={!s.changed}>
          {t('recipe.scale.reset')}
        </button>
      </div>
      {s.customError && (
        <p id={errId} role="alert" className="text-red-800 dark:text-red-300">
          {t('recipe.scale.invalid', { max: MAX_FACTOR })}
        </p>
      )}
      <p role="status" aria-live="polite" className="text-neutral-700 dark:text-neutral-300">
        {summary}
      </p>
    </section>
  );
}
