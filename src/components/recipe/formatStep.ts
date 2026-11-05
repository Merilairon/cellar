import type { ApiStep } from './types';

type StepParams = Pick<ApiStep, 'label' | 'temp_c' | 'temp_f' | 'minutes_min' | 'minutes_max'>;

export type StepT = (
  key: 'recipe.step.timeRange' | 'recipe.step.timeSingle',
  values: { min: number; max: number },
) => string;

/** "350°F (170°C) 30 to 40 min": both temperatures when stored, no conversion. */
export function formatStepParams(step: Omit<StepParams, 'label'>, t: StepT): string {
  const parts: string[] = [];
  if (step.temp_f != null && step.temp_c != null) parts.push(`${step.temp_f}°F (${step.temp_c}°C)`);
  else if (step.temp_f != null) parts.push(`${step.temp_f}°F`);
  else if (step.temp_c != null) parts.push(`${step.temp_c}°C`);
  const lo = step.minutes_min ?? step.minutes_max;
  const hi = step.minutes_max ?? step.minutes_min;
  if (lo != null && hi != null) {
    parts.push(
      lo === hi
        ? t('recipe.step.timeSingle', { min: lo, max: hi })
        : t('recipe.step.timeRange', { min: lo, max: hi }),
    );
  }
  return parts.join(' ');
}

/** Label plus parameters on one line, e.g. "bake 350°F (170°C) 30 to 40 min". */
export function formatStepLine(step: StepParams, t: StepT): string {
  return [step.label, formatStepParams(step, t)].filter(Boolean).join(' ');
}
