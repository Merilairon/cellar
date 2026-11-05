import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import { formatStepLine, formatStepParams, type StepT } from './formatStep';

// Minimal stand-in for the two ICU messages used by the formatter.
const t: StepT = (key, v) =>
  (key === 'recipe.step.timeRange' ? en.recipe.step.timeRange : en.recipe.step.timeSingle)
    .replace('{min}', String(v.min))
    .replace('{max}', String(v.max));
const none = { temp_c: null, temp_f: null, minutes_min: null, minutes_max: null };

describe('formatStep', () => {
  it('matches the reference wording', () => {
    expect(
      formatStepLine(
        { label: 'bake', temp_f: 350, temp_c: 170, minutes_min: 30, minutes_max: 40 },
        t,
      ),
    ).toBe('bake 350°F (170°C) 30 to 40 min');
  });
  it('handles single temperature and single time', () => {
    expect(formatStepParams({ ...none, temp_c: 180 }, t)).toBe('180°C');
    expect(formatStepParams({ ...none, temp_f: 350 }, t)).toBe('350°F');
    expect(formatStepParams({ ...none, minutes_min: 10, minutes_max: 10 }, t)).toBe('10 min');
    expect(formatStepParams({ ...none, minutes_max: 15 }, t)).toBe('15 min');
  });
  it('is just the label when there are no parameters', () => {
    expect(formatStepLine({ label: 'mix', ...none }, t)).toBe('mix');
    expect(formatStepParams(none, t)).toBe('');
  });
});
