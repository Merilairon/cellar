import type { MappingLevel } from '@/lib/import/map-types';

// Pure state of the mapping panel on the review screen (UX spec sections 1, 4, 5). The form
// itself lives in RecipeForm; this only tracks which structure was loaded and what to ask.

export type MapMode = 'grid' | 'list';
/** What the last structure load was; drives the state line. */
export type MapStatus = 'initial' | 'applied' | 'restored' | 'list';
/** The three actions that replace the sections array. */
export type MapAction = 'preview' | 'list' | 'reset';

export type MapState = {
  mode: MapMode;
  status: MapStatus;
  /** Bumped on every structure load; the review screen uses it as the form's remount key. */
  version: number;
  /** An action waiting for the user to confirm replacing their edits. */
  confirm: MapAction | null;
};

/** High opens as grid with the proposal applied; medium and low open as the page-order list. */
export const initialMapState = (level: MappingLevel): MapState => ({
  mode: level === 'high' ? 'grid' : 'list',
  status: 'initial',
  version: 0,
  confirm: null,
});

export type MapEvent =
  { type: 'ask'; action: MapAction } | { type: 'cancel' } | { type: 'done'; action: MapAction };

export function mapReducer(s: MapState, e: MapEvent): MapState {
  switch (e.type) {
    case 'ask':
      return { ...s, confirm: e.action };
    case 'cancel':
      return { ...s, confirm: null };
    case 'done':
      return {
        mode: e.action === 'list' ? 'list' : 'grid',
        status: e.action === 'list' ? 'list' : e.action === 'reset' ? 'restored' : 'applied',
        version: s.version + 1,
        confirm: null,
      };
  }
}

/** Which state sentence to show; `edited` only counts while the grid is applied. */
export function stateKey(
  s: Pick<MapState, 'mode' | 'status'>,
  edited: boolean,
): 'applied' | 'edited' | 'restored' | 'list' | null {
  if (s.mode === 'list') return s.status === 'list' ? 'list' : null;
  if (edited) return 'edited';
  return s.status === 'restored' ? 'restored' : 'applied';
}

/** Explicit view_mode for the save payload, only when the screen offered the choice. */
export const saveViewMode = (mapping: object | null, mode: MapMode): { view_mode?: MapMode } =>
  mapping ? { view_mode: mode } : {};
