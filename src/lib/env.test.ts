import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { SESSION_SECRET: 'x'.repeat(10) + 'k'.repeat(10) + 'z'.repeat(12) };

describe('headless env', () => {
  it('is optional: unset and empty both mean off', () => {
    expect(parseEnv(base).HEADLESS_URL).toBeUndefined();
    const e = parseEnv({ ...base, HEADLESS_URL: '', HEADLESS_TOKEN: '' });
    expect(e.HEADLESS_URL).toBeUndefined();
    expect(e.HEADLESS_TOKEN).toBeUndefined();
    expect(e.HEADLESS_TIMEOUT_MS).toBe(35_000);
  });

  it('accepts a bare http origin', () => {
    expect(
      parseEnv({ ...base, HEADLESS_URL: 'http://browser:3001', HEADLESS_TOKEN: 'a'.repeat(32) })
        .HEADLESS_URL,
    ).toBe('http://browser:3001');
  });

  it.each([
    'https://browser:3001',
    'http://u:p@browser:3001',
    'http://browser:3001/x',
    'http://browser:3001/?a=1',
    'ftp://browser',
    'not a url',
  ])('rejects %s', (v) => {
    expect(() => parseEnv({ ...base, HEADLESS_URL: v, HEADLESS_TOKEN: 'a'.repeat(32) })).toThrow(
      /HEADLESS_URL/,
    );
  });

  it('HEADLESS_URL requires a token unless HEADLESS_ALLOW_NO_TOKEN=1', () => {
    const url = 'http://browser:3001';
    expect(() => parseEnv({ ...base, HEADLESS_URL: url })).toThrow(/HEADLESS_TOKEN/);
    expect(() => parseEnv({ ...base, HEADLESS_URL: url, HEADLESS_TOKEN: '' })).toThrow();
    expect(parseEnv({ ...base, HEADLESS_URL: url, HEADLESS_TOKEN: 'a'.repeat(32) })).toBeTruthy();
    expect(parseEnv({ ...base, HEADLESS_URL: url, HEADLESS_ALLOW_NO_TOKEN: '1' })).toBeTruthy();
  });

  it('token uses the sidecar charset, not just its length', () => {
    expect(() => parseEnv({ ...base, HEADLESS_TOKEN: 'a'.repeat(31) + '!' })).toThrow();
    expect(() => parseEnv({ ...base, HEADLESS_TOKEN: 'a'.repeat(40) + ' x' })).toThrow();
    expect(parseEnv({ ...base, HEADLESS_TOKEN: 'aB3+/_=-'.repeat(5) }).HEADLESS_TOKEN).toBeTruthy();
  });

  it('token needs 32+ chars (same as the sidecar); timeout is capped at 35000', () => {
    expect(() => parseEnv({ ...base, HEADLESS_TOKEN: 'short' })).toThrow();
    expect(() => parseEnv({ ...base, HEADLESS_TOKEN: 'a'.repeat(31) })).toThrow();
    expect(parseEnv({ ...base, HEADLESS_TOKEN: 'a'.repeat(32) }).HEADLESS_TOKEN).toBeDefined();
    expect(() => parseEnv({ ...base, HEADLESS_TIMEOUT_MS: '40000' })).toThrow();
    expect(parseEnv({ ...base, HEADLESS_TIMEOUT_MS: '1000' }).HEADLESS_TIMEOUT_MS).toBe(1000);
  });
});
