import { sectionInputSchema } from '@/lib/recipes/schemas';
import { mapGrid as defaultMapGrid } from './map-grid';
import type { MapInput, MapResult, MappingProposal } from './map-types';
import type { Draft } from './normalize';

// Attaches the auto-mapper's proposal to a draft (tasklist T7, G9, G11, G21). The 3a
// sections stay exactly as normalize produced them; the proposal lives beside them. Any
// failure, size overrun or exception leaves `mapping: null` plus a warning code and never
// fails the import.

/** A proposal larger than this is dropped (`mapping_too_large`). */
export const MAX_MAPPING_BYTES = 512 * 1024;
/** The whole serialized draft (with the proposal) must stay below this. */
export const MAX_DRAFT_BYTES = 1024 * 1024;

export type MapFn = (input: MapInput) => MapResult;

/** Mapper failure codes that are shown as notes about the page (closed set). */
const FAILURE_CODES: ReadonlySet<string> = new Set([
  'mapping_invalid',
  'mapping_budget',
  'mapping_too_large',
  'too_many_sections',
  'input_truncated',
]);

const byteLength = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

export type MappingOutcome = { draft: Draft; warnings: string[] };

export function attachMapping(
  draft: Draft,
  mapInput: MapInput | null,
  opts: { mapGrid?: MapFn; log?: (msg: string, err?: unknown) => void } = {},
): MappingOutcome {
  const base: Draft = { ...draft, mapping: null };
  if (!mapInput) return { draft: base, warnings: [] };
  let result: MapResult;
  try {
    result = (opts.mapGrid ?? defaultMapGrid)(mapInput);
  } catch (e) {
    opts.log?.('mapping failed: unexpected', e);
    return { draft: base, warnings: ['mapping_invalid'] };
  }
  if (!result.mapped) {
    const warnings = result.warnings.filter((w) => FAILURE_CODES.has(w));
    if (result.reason === 'error' && !warnings.includes('mapping_invalid')) {
      warnings.push('mapping_invalid');
    }
    return { draft: base, warnings: [...new Set(warnings)] };
  }
  const withMapping: Draft = { ...draft, mapping: result.proposal };
  if (
    byteLength(result.proposal) > MAX_MAPPING_BYTES ||
    byteLength(withMapping) > MAX_DRAFT_BYTES
  ) {
    return { draft: base, warnings: ['mapping_too_large'] };
  }
  return { draft: withMapping, warnings: [] };
}

const sectionsSchema = sectionInputSchema.array().min(1).max(20);
const LEVELS: ReadonlySet<unknown> = new Set(['high', 'medium', 'low']);

/** Structural check of a proposal read back from `draft_json` (old or tampered rows give null). */
export function readMapping(v: unknown): MappingProposal | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  if (m['version'] !== 1) return null;
  if (typeof m['confidence'] !== 'number' || !(m['confidence'] >= 0 && m['confidence'] <= 1)) {
    return null;
  }
  if (!LEVELS.has(m['level'])) return null;
  if (!Array.isArray(m['sections']) || m['sections'].length === 0) return null;
  // The review screen builds its form from these sections, so they must be real sections.
  if (!sectionsSchema.safeParse(m['sections']).success) return null;
  if (!Array.isArray(m['warnings']) || !m['warnings'].every((w) => typeof w === 'string')) {
    return null;
  }
  if (typeof m['signals'] !== 'object' || m['signals'] === null) return null;
  return v as MappingProposal;
}
