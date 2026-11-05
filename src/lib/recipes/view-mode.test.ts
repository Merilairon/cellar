import { describe, expect, it } from 'vitest';
import {
  effectiveViewMode,
  maxColumnsInSection,
  parseStoredViewMode,
  viewPrefKey,
} from './view-mode';

const base = {
  recipeViewMode: 'grid',
  stored: null,
  maxColumnsInSection: 5,
  isPhone: false,
} as const;

describe('effectiveViewMode', () => {
  it('defaults to grid', () => expect(effectiveViewMode(base)).toBe('grid'));
  it('list recipes are always list, even with a stored grid preference', () => {
    expect(effectiveViewMode({ ...base, recipeViewMode: 'list', stored: 'grid' })).toBe('list');
  });
  it('stored preference wins over the default', () => {
    expect(effectiveViewMode({ ...base, stored: 'list' })).toBe('list');
    expect(
      effectiveViewMode({ ...base, stored: 'grid', isPhone: true, maxColumnsInSection: 9 }),
    ).toBe('grid');
  });
  it('more than 8 columns default to list on phones only', () => {
    expect(effectiveViewMode({ ...base, maxColumnsInSection: 9, isPhone: true })).toBe('list');
    expect(effectiveViewMode({ ...base, maxColumnsInSection: 8, isPhone: true })).toBe('grid');
    expect(effectiveViewMode({ ...base, maxColumnsInSection: 9, isPhone: false })).toBe('grid');
  });
});

describe('helpers', () => {
  it('parses only valid stored values', () => {
    expect(parseStoredViewMode('grid')).toBe('grid');
    expect(parseStoredViewMode('list')).toBe('list');
    expect(parseStoredViewMode('x')).toBeNull();
    expect(parseStoredViewMode(null)).toBeNull();
  });
  it('counts columns per section and takes the max', () => {
    expect(
      maxColumnsInSection([
        { steps: [{ kind: 'column' }, { kind: 'banner_top' }] },
        { steps: [{ kind: 'column' }, { kind: 'column' }, { kind: 'banner_bottom' }] },
      ]),
    ).toBe(2);
    expect(maxColumnsInSection([])).toBe(0);
  });
  it('keys per user', () => expect(viewPrefKey('u1')).toBe('cellar:viewMode:u1'));
});
