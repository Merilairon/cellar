import { describe, expect, it } from 'vitest';
import { isCsrfSafe } from './csrf';

const base = 'https://recipes.example.com';
const h = (o: Record<string, string>) => new Headers(o);

describe('isCsrfSafe', () => {
  it('allows safe methods without proof', () => {
    expect(isCsrfSafe('GET', h({}), base)).toBe(true);
  });
  it('accepts matching Origin or same-origin Sec-Fetch-Site', () => {
    expect(isCsrfSafe('POST', h({ origin: base }), base)).toBe(true);
    expect(isCsrfSafe('POST', h({ 'sec-fetch-site': 'same-origin' }), base)).toBe(true);
  });
  it('rejects foreign Origin, cross-site fetch metadata and missing proof', () => {
    expect(isCsrfSafe('POST', h({ origin: 'https://evil.test' }), base)).toBe(false);
    expect(isCsrfSafe('POST', h({ 'sec-fetch-site': 'cross-site' }), base)).toBe(false);
    expect(isCsrfSafe('POST', h({ 'sec-fetch-site': 'same-site', origin: base }), base)).toBe(
      false,
    );
    expect(isCsrfSafe('DELETE', h({}), base)).toBe(false);
  });
});
