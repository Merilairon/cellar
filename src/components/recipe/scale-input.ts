// Pure logic behind the custom scale field.
import { MAX_FACTOR, MIN_FACTOR } from '@/lib/units/scale';

/**
 * "1,5" and "1.5" both work. Anything else that is not a plain positive number is invalid, including
 * thousands separators: "1,000" (and "1,000.5", "1.000,5") is ambiguous between 1 and 1000, so it is
 * rejected instead of guessed.
 */
export function parseCustomAmount(text: string): number | null {
  const s = text.trim();
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return null;
  // A comma followed by exactly three digits after a non-zero integer part reads as a thousands group.
  if (/^[1-9]\d*,\d{3}$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The scale factor for custom text: a servings target when `servings` is known, else a multiplier. */
export function customFactorFor(text: string, servings: number | null): number | null {
  const n = parseCustomAmount(text);
  if (n === null) return null;
  const f = servings != null ? n / servings : n;
  return Number.isFinite(f) && f >= MIN_FACTOR && f <= MAX_FACTOR ? f : null;
}

export type CustomState = { text: string; factor: number };

/**
 * Choosing Custom keeps the amounts as they are on screen (the factor of the preset being left)
 * and starts with an empty field; opening the field changes nothing.
 */
export function enterCustom(currentFactor: number): CustomState {
  return { text: '', factor: currentFactor };
}

/** Typing: a valid value is applied, an invalid one leaves the last applied factor in place. */
export function typeCustom(prev: CustomState, text: string, servings: number | null): CustomState {
  const f = customFactorFor(text, servings);
  return { text, factor: f ?? prev.factor };
}

export type SummaryKind = 'original' | 'factor' | 'servings' | 'invalid';

/** Which live-region sentence applies; the unit suffix is added when the units were flipped. */
export function summaryKind(o: {
  factor: number;
  customError: boolean;
  servings: number | null;
}): SummaryKind {
  if (o.customError) return 'invalid';
  if (o.factor === 1) return 'original';
  return o.servings != null ? 'servings' : 'factor';
}
