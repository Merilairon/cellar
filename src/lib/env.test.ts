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

describe('PUBLIC_LINKS_ENABLED', () => {
  it('defaults to true', () => {
    expect(parseEnv(base).PUBLIC_LINKS_ENABLED).toBe(true);
  });

  it('parses the two literal strings', () => {
    expect(parseEnv({ ...base, PUBLIC_LINKS_ENABLED: 'true' }).PUBLIC_LINKS_ENABLED).toBe(true);
    expect(parseEnv({ ...base, PUBLIC_LINKS_ENABLED: 'false' }).PUBLIC_LINKS_ENABLED).toBe(false);
  });

  it.each(['maybe', '1', '0', 'TRUE', 'yes', ''])(
    'rejects %j with a message naming the variable',
    (v) => {
      expect(() => parseEnv({ ...base, PUBLIC_LINKS_ENABLED: v })).toThrow(
        /PUBLIC_LINKS_ENABLED must be \\"true\\" or \\"false\\"/,
      );
    },
  );
});

describe('LOG_LEVEL', () => {
  it('defaults to info', () => {
    expect(parseEnv(base).LOG_LEVEL).toBe('info');
  });

  it.each(['debug', 'info', 'warn', 'error'])('accepts %s', (v) => {
    expect(parseEnv({ ...base, LOG_LEVEL: v }).LOG_LEVEL).toBe(v);
  });

  it.each(['trace', 'INFO', 'verbose', ''])('rejects %j naming the variable', (v) => {
    expect(() => parseEnv({ ...base, LOG_LEVEL: v })).toThrow(/LOG_LEVEL must be/);
  });
});

describe('restore rate limit env', () => {
  it('defaults to 10 per 3600 seconds', () => {
    const e = parseEnv(base);
    expect([e.RATE_LIMIT_RESTORE_MAX, e.RATE_LIMIT_RESTORE_WINDOW_SEC]).toEqual([10, 3600]);
  });

  it('accepts positive integers and rejects zero, negatives and non-numbers', () => {
    const e = parseEnv({
      ...base,
      RATE_LIMIT_RESTORE_MAX: '3',
      RATE_LIMIT_RESTORE_WINDOW_SEC: '60',
    });
    expect([e.RATE_LIMIT_RESTORE_MAX, e.RATE_LIMIT_RESTORE_WINDOW_SEC]).toEqual([3, 60]);
    for (const v of ['0', '-1', 'abc', '1.5']) {
      expect(() => parseEnv({ ...base, RATE_LIMIT_RESTORE_MAX: v })).toThrow();
      expect(() => parseEnv({ ...base, RATE_LIMIT_RESTORE_WINDOW_SEC: v })).toThrow();
    }
  });
});

describe('export rate limit env', () => {
  it('defaults to 10 per 3600 seconds', () => {
    const e = parseEnv(base);
    expect([e.RATE_LIMIT_EXPORT_MAX, e.RATE_LIMIT_EXPORT_WINDOW_SEC]).toEqual([10, 3600]);
  });

  it('accepts positive integers and rejects zero, negatives and non-numbers', () => {
    const e = parseEnv({ ...base, RATE_LIMIT_EXPORT_MAX: '2', RATE_LIMIT_EXPORT_WINDOW_SEC: '30' });
    expect([e.RATE_LIMIT_EXPORT_MAX, e.RATE_LIMIT_EXPORT_WINDOW_SEC]).toEqual([2, 30]);
    for (const v of ['0', '-1', 'abc', '1.5']) {
      expect(() => parseEnv({ ...base, RATE_LIMIT_EXPORT_MAX: v })).toThrow();
      expect(() => parseEnv({ ...base, RATE_LIMIT_EXPORT_WINDOW_SEC: v })).toThrow();
    }
  });
});

describe('public page rate limit env', () => {
  it('defaults to 120 per 60 seconds', () => {
    const e = parseEnv(base);
    expect(e.RATE_LIMIT_PUBLIC_MAX).toBe(120);
    expect(e.RATE_LIMIT_PUBLIC_WINDOW_SEC).toBe(60);
  });

  it('accepts positive integers and rejects zero, negatives and non-numbers', () => {
    const e = parseEnv({ ...base, RATE_LIMIT_PUBLIC_MAX: '5', RATE_LIMIT_PUBLIC_WINDOW_SEC: '10' });
    expect([e.RATE_LIMIT_PUBLIC_MAX, e.RATE_LIMIT_PUBLIC_WINDOW_SEC]).toEqual([5, 10]);
    for (const v of ['0', '-1', 'abc', '1.5']) {
      expect(() => parseEnv({ ...base, RATE_LIMIT_PUBLIC_MAX: v })).toThrow();
      expect(() => parseEnv({ ...base, RATE_LIMIT_PUBLIC_WINDOW_SEC: v })).toThrow();
    }
  });
});

describe('restore env', () => {
  it('defaults: 256 MiB cap, restore dir next to the uploads dir', () => {
    const e = parseEnv({ ...base, DATABASE_PATH: '/data/app.db' });
    expect(e.RESTORE_BODY_MAX).toBe(268_435_456);
    expect(e.RESTORE_DIR).toBe('/data/restore');
    expect(parseEnv({ ...base, UPLOADS_DIR: '/mnt/u/uploads' }).RESTORE_DIR).toBe('/mnt/u/restore');
  });

  it('accepts overrides and rejects non-numbers, tiny and huge caps', () => {
    const e = parseEnv({ ...base, RESTORE_BODY_MAX: '5000', RESTORE_DIR: '/tmp/r' });
    expect([e.RESTORE_BODY_MAX, e.RESTORE_DIR]).toEqual([5000, '/tmp/r']);
    for (const v of ['0', '-1', 'abc', '1.5', '1000', '99999999999']) {
      expect(() => parseEnv({ ...base, RESTORE_BODY_MAX: v })).toThrow();
    }
    expect(() => parseEnv({ ...base, RESTORE_DIR: '' })).toThrow();
  });
});
