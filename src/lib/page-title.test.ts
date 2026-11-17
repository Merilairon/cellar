import { describe, expect, it } from 'vitest';
import { contentTitle } from './page-title';

describe('contentTitle', () => {
  it('returns a normal title trimmed with inner whitespace collapsed', () => {
    expect(contentTitle('  Vanilla   Cake ', 'Untitled')).toBe('Vanilla Cake');
  });
  it('falls back for empty, whitespace-only, null and undefined', () => {
    for (const v of ['', '   ', '\t\n', null, undefined]) {
      expect(contentTitle(v, 'Untitled recipe')).toBe('Untitled recipe');
    }
  });
});
