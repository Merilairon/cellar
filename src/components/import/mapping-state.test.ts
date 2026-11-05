import { describe, expect, it } from 'vitest';
import { initialMapState, mapReducer, saveViewMode, stateKey } from './mapping-state';

describe('mapping state', () => {
  it('opens as grid only for high', () => {
    expect(initialMapState('high').mode).toBe('grid');
    expect(initialMapState('medium').mode).toBe('list');
    expect(initialMapState('low').mode).toBe('list');
  });

  it('preview, list and reset reload the structure and bump the version', () => {
    let s = initialMapState('medium');
    s = mapReducer(s, { type: 'done', action: 'preview' });
    expect([s.mode, s.status, s.version]).toEqual(['grid', 'applied', 1]);
    s = mapReducer(s, { type: 'done', action: 'reset' });
    expect([s.mode, s.status, s.version]).toEqual(['grid', 'restored', 2]);
    s = mapReducer(s, { type: 'done', action: 'list' });
    expect([s.mode, s.status, s.version]).toEqual(['list', 'list', 3]);
  });

  it('ask opens a confirm that cancel closes without reloading', () => {
    const s = mapReducer(initialMapState('high'), { type: 'ask', action: 'list' });
    expect(s.confirm).toBe('list');
    const c = mapReducer(s, { type: 'cancel' });
    expect([c.confirm, c.version, c.mode]).toEqual([null, 0, 'grid']);
  });

  it('state line key', () => {
    expect(stateKey({ mode: 'grid', status: 'initial' }, false)).toBe('applied');
    expect(stateKey({ mode: 'grid', status: 'restored' }, false)).toBe('restored');
    expect(stateKey({ mode: 'grid', status: 'applied' }, true)).toBe('edited');
    expect(stateKey({ mode: 'list', status: 'initial' }, true)).toBeNull();
    expect(stateKey({ mode: 'list', status: 'list' }, false)).toBe('list');
  });

  it('sends view_mode only when a proposal exists', () => {
    expect(saveViewMode(null, 'list')).toEqual({});
    expect(saveViewMode({}, 'grid')).toEqual({ view_mode: 'grid' });
  });
});
