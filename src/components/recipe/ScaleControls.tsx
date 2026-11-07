'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { factorFromServings, MAX_FACTOR, MIN_FACTOR } from '@/lib/units/scale';
import { formatQty } from '@/lib/units/display';
import type { UnitSystem } from '@/lib/units/units';
import type { QuantityDisplay } from './IngredientCell';
import { btn, input } from './styles';

type Preset = 'half' | 'one' | 'two' | 'custom';
const PRESET_FACTOR: Record<Exclude<Preset, 'custom'>, number> = { half: 0.5, one: 1, two: 2 };

/** "1,5" and "1.5" both work; anything else that is not a plain positive number is invalid. */
export function parseCustomAmount(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** View state only: nothing here is persisted, so a reload goes back to the user's preference. */
export function useScale(pref: UnitSystem, servings: number | null) {
  const [preset, setPreset] = useState<Preset>('one');
  const [customText, setCustomText] = useState('');
  const [customFactor, setCustomFactor] = useState(1);
  const [toggle, setToggle] = useState<UnitSystem | null>(null);

  const customFactorFor = (text: string): number | null => {
    const n = parseCustomAmount(text);
    if (n === null) return null;
    const f = servings != null ? factorFromServings(servings, n) : n;
    // factorFromServings clamps; reject out-of-range input instead of silently clamping.
    const raw = servings != null ? n / servings : n;
    return f !== null && raw >= MIN_FACTOR && raw <= MAX_FACTOR ? raw : null;
  };

  const factor = preset === 'custom' ? customFactor : PRESET_FACTOR[preset];
  const primary: UnitSystem = toggle ?? pref;
  const display = useMemo<QuantityDisplay>(
    () => ({ pref, scale: factor, toggle }),
    [pref, factor, toggle],
  );
  const customError =
    preset === 'custom' && customText !== '' && customFactorFor(customText) === null;

  return {
    display,
    factor,
    preset,
    customText,
    customError,
    primary,
    changed: factor !== 1 || toggle !== null,
    choose: (p: Preset) => setPreset(p),
    setCustom: (text: string) => {
      setCustomText(text);
      const f = customFactorFor(text);
      if (f !== null) setCustomFactor(f);
    },
    flip: () => setToggle(primary === 'metric' ? 'us' : 'metric'),
    reset: () => {
      setPreset('one');
      setCustomText('');
      setCustomFactor(1);
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

  let summary: string;
  if (s.factor === 1 && s.display.toggle === null) summary = t('recipe.scale.summaryOriginal');
  else if (scaledServings != null)
    summary = t('recipe.scale.summaryServings', {
      factor: factorText,
      servings: Number.isInteger(scaledServings)
        ? String(scaledServings)
        : `≈ ${formatQty(scaledServings)}`,
    });
  else summary = t('recipe.scale.summaryFactor', { factor: factorText });

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
