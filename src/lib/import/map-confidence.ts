// Confidence scoring (tasklist "Confidence scoring", data-model §3 step 6). Pure.
// Initial weights, frozen after the T8 calibration; any change re-baselines the goldens.

import type { MappingLevel, MappingSignals } from './map-types';

export const CONFIDENCE_THRESHOLDS = { high: 0.7, medium: 0.4 } as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Level of an already rounded confidence: 0.70 is high, 0.40 is medium. */
export function levelOf(confidence: number): MappingLevel {
  const c = round2(confidence);
  if (c >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (c >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * confidence = cov^2 * (0.55 + 0.20*unamb + 0.15*verbs + 0.10*splitOk) * secFactor
 *              - min(0.15, 0.05 * groupRefs), then the caps below, rounded to 2 decimals.
 * Caps: <2 column steps 0.50; one distinct span 0.55; >30% unmatched 0.60; no recognized
 * verb at all 0.39 (added at T8 calibration for G18).
 * `gridErrors > 0` (validateRecipeGrid) gives 0: the caller discards the proposal.
 */
export function computeConfidence(
  s: MappingSignals,
  gridErrors = 0,
): { confidence: number; level: MappingLevel } {
  if (gridErrors > 0) return { confidence: 0, level: 'low' };
  const cov = clamp01(s.cov);
  let raw =
    cov *
    cov *
    (0.55 + 0.2 * clamp01(s.unamb) + 0.15 * clamp01(s.verbs) + 0.1 * clamp01(s.splitOk)) *
    Math.min(1, Math.max(0.5, s.secFactor));
  raw -= Math.min(0.15, 0.05 * Math.max(0, s.groupRefs));
  if (s.columnSteps < 2) raw = Math.min(raw, 0.5);
  if (s.columnSteps >= 2 && s.distinctSpans <= 1) raw = Math.min(raw, 0.55);
  if (1 - cov > 0.3) raw = Math.min(raw, 0.6);
  // No column step has a recognized verb (non-English or noun-only steps): every label is a
  // fallback, so the proposal is not trusted (G18: such recipes "get low confidence").
  if (s.columnSteps > 0 && s.verbs <= 0) raw = Math.min(raw, 0.39);
  const confidence = round2(clamp01(raw));
  return { confidence, level: levelOf(confidence) };
}
