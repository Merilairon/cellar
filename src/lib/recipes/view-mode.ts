import type { ViewMode } from './schemas';

export const VIEW_PREF_PREFIX = 'cellar:viewMode:';
/** More column steps than this in one section default to list on phones (no stored preference). */
export const MAX_PHONE_GRID_COLUMNS = 8;

export const viewPrefKey = (userId: string): string => `${VIEW_PREF_PREFIX}${userId}`;

export function parseStoredViewMode(value: string | null | undefined): ViewMode | null {
  return value === 'grid' || value === 'list' ? value : null;
}

export function maxColumnsInSection(
  sections: ReadonlyArray<{ steps: ReadonlyArray<{ kind: string }> }>,
): number {
  return sections.reduce(
    (max, s) => Math.max(max, s.steps.filter((st) => st.kind === 'column').length),
    0,
  );
}

/**
 * Effective view: a `list` recipe (invalid or missing spans) can only be shown as list; else
 * the stored per-user preference; else grid, except wide recipes on phones.
 */
export function effectiveViewMode(input: {
  recipeViewMode: ViewMode;
  stored: ViewMode | null;
  maxColumnsInSection: number;
  isPhone: boolean;
}): ViewMode {
  if (input.recipeViewMode === 'list') return 'list';
  if (input.stored) return input.stored;
  if (input.isPhone && input.maxColumnsInSection > MAX_PHONE_GRID_COLUMNS) return 'list';
  return 'grid';
}
