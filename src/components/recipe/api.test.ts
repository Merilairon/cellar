import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from './api';

describe('safeHttpUrl', () => {
  it('returns the normalized href for http(s) only', () => {
    expect(safeHttpUrl('https://example.com')).toBe('https://example.com/');
    expect(safeHttpUrl('http://example.com/a b')).toBe('http://example.com/a%20b');
    expect(safeHttpUrl(' https://example.com/x')).toBe('https://example.com/x');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://x.test',
      'nope',
      '',
      null,
      undefined,
    ]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});
