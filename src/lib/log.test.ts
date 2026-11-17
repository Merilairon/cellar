import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errCode, log } from './log';

let out: string[];
let err: string[];
const original = process.env.LOG_LEVEL;

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => (out.push(String(c)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => (err.push(String(c)), true));
  delete process.env.LOG_LEVEL;
});
afterEach(() => {
  vi.restoreAllMocks();
  if (original === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = original;
});

const parse = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('log hardening (backend review)', () => {
  it('redacts credential-like key variants by normalised substring', () => {
    log('info', 'x', {
      'Set-Cookie': 'a',
      'x-api-key': 'a',
      refresh_token: 'a',
      accessToken: 'a',
      userEmail: 'a',
      'X-Forwarded-For': '1.2.3.4',
      share_url: 'http://h/r/abcdefghijklmnopqrstuv',
      ip: '1.2.3.4',
      Passwd: 'a',
      csrf: 'a',
      count: 3,
    });
    const o = JSON.parse(out[0]!) as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (['ts', 'level', 'event', 'count'].includes(k)) continue;
      expect(v, k).toBe('[redacted]');
    }
    expect(o.count).toBe(3);
  });

  it('scrubs secrets inside string values and error messages', () => {
    log('error', 'x', {
      msg: 'fetch https://user:pw@h.example/a?token=SECRETQ failed at /r/abcdefghijklmnopqrstuv',
      err: Object.assign(new Error("ENOENT: open '/data/uploads/01ABC.webp'"), { code: 'ENOENT' }),
    });
    const line = err[0]!;
    expect(line).not.toMatch(/SECRETQ|user:pw|abcdefghijklmnopqrstuv|\/data\/uploads/);
    const o = JSON.parse(line) as { err: Record<string, unknown> };
    expect(o.err.code).toBe('ENOENT');
  });

  it('caps arrays and wide objects and summarises bytes, Map and Set', () => {
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    log('info', 'x', {
      arr: Array.from({ length: 10_000 }, (_, i) => i),
      wide,
      buf: Buffer.alloc(5_000_000),
      m: new Map([[1, 2]]),
      s: new Set([1]),
    });
    const o = JSON.parse(out[0]!) as Record<string, unknown>;
    expect((o.arr as unknown[]).length).toBe(51);
    expect(Object.keys(o.wide as object).length).toBeLessThanOrEqual(51);
    expect(o.buf).toBe('[bytes:5000000]');
    expect(o.m).toBe('[Map(1)]');
    expect(o.s).toBe('[Set(1)]');
  });

  it('a throwing getter loses only its own field', () => {
    log('info', 'x', {
      o: {
        ok: 1,
        get bad(): never {
          throw new Error('x');
        },
      },
    });
    expect(JSON.parse(out[0]!)).toMatchObject({ o: { ok: 1, bad: '[unserializable]' } });
  });

  it('an inherited property name as LOG_LEVEL falls back to info', () => {
    process.env.LOG_LEVEL = 'constructor';
    log('debug', 'hidden');
    log('info', 'shown');
    expect(out).toHaveLength(1);
  });
});

describe('log', () => {
  it('writes exactly one JSON object per call, newline terminated', () => {
    log('info', 'a.b', { n: 1, s: 'multi\nline' });
    log('info', 'c.d');
    expect(out).toHaveLength(2);
    for (const l of out) {
      expect(l.endsWith('\n')).toBe(true);
      expect(l.slice(0, -1)).not.toContain('\n');
    }
    const [first] = parse(out);
    expect(first).toMatchObject({ level: 'info', event: 'a.b', n: 1, s: 'multi\nline' });
    expect(new Date(first!.ts as string).toISOString()).toBe(first!.ts);
  });

  it('routes debug/info to stdout and warn/error to stderr', () => {
    process.env.LOG_LEVEL = 'debug';
    for (const lv of ['debug', 'info', 'warn', 'error'] as const) log(lv, 'x');
    expect(parse(out).map((o) => o.level)).toEqual(['debug', 'info']);
    expect(parse(err).map((o) => o.level)).toEqual(['warn', 'error']);
  });

  it('filters by LOG_LEVEL, default info', () => {
    log('debug', 'hidden');
    expect(out).toHaveLength(0);
    process.env.LOG_LEVEL = 'error';
    log('info', 'hidden');
    log('warn', 'hidden');
    log('error', 'shown');
    expect(out).toHaveLength(0);
    expect(parse(err).map((o) => o.event)).toEqual(['shown']);
    process.env.LOG_LEVEL = 'warn';
    log('warn', 'w');
    expect(err).toHaveLength(2);
  });

  it('redacts sensitive keys case-insensitively, at any depth, inside arrays', () => {
    log('info', 'x', {
      token: 't',
      Share_Token: 't',
      shareToken: 't',
      EMAIL: 'a@b.c',
      password: 'p',
      password_hash: 'h',
      secret: 's',
      session: 's',
      cookie: 'c',
      Authorization: 'Bearer x',
      body: 'b',
      note: 'n',
      notes: ['n'],
      raw: '<p>',
      html: '<p>',
      keep: 'ok',
      nested: { deep: [{ Token: 'zzz', fine: 1 }] },
    });
    const line = out[0]!;
    const o = JSON.parse(line) as Record<string, unknown>;
    for (const k of [
      'token',
      'Share_Token',
      'shareToken',
      'EMAIL',
      'password',
      'password_hash',
      'secret',
      'session',
      'cookie',
      'Authorization',
      'body',
      'note',
      'notes',
      'raw',
      'html',
    ])
      expect(o[k]).toBe('[redacted]');
    expect(o.keep).toBe('ok');
    expect(o.nested).toEqual({ deep: [{ Token: '[redacted]', fine: 1 }] });
    expect(line).not.toMatch(/a@b\.c|Bearer|zzz|<p>/);
  });

  it('caller fields cannot overwrite ts, level or event', () => {
    log('info', 'real', { event: 'fake', level: 'fake', ts: 'fake' });
    expect(parse(out)[0]).toMatchObject({ event: 'real', level: 'info' });
    expect(parse(out)[0]!.ts).not.toBe('fake');
  });

  it('never throws: circular, BigInt, getters, functions', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const bomb = {
      get boom(): never {
        throw new Error('getter');
      },
    };
    expect(() => log('info', 'x', { a, big: 10n, fn: () => 1, bomb })).not.toThrow();
    log('info', 'y', { a, big: 10n });
    const o = parse(out).at(-1)!;
    expect(o.big).toBe('10');
    expect((o.a as Record<string, unknown>).self).toBe('[circular]');
  });

  it('a shared (non-circular) reference is logged twice, not marked circular', () => {
    const shared = { v: 1 };
    log('info', 'x', { a: shared, b: shared });
    expect(parse(out)[0]).toMatchObject({ a: { v: 1 }, b: { v: 1 } });
  });

  it('serialises Error as {name, message} without stack, stack only at debug', () => {
    log('error', 'x', { err: new TypeError('bad') });
    const e = (parse(err)[0] as { err: Record<string, unknown> }).err;
    expect(e).toEqual({ name: 'TypeError', message: 'bad' });
    process.env.LOG_LEVEL = 'debug';
    log('error', 'x', { err: new TypeError('bad') });
    expect((parse(err)[1] as { err: { stack?: string } }).err.stack).toContain('TypeError');
  });

  it('truncates long strings', () => {
    log('info', 'x', { s: 'a'.repeat(5000) });
    const s = (parse(out)[0] as { s: string }).s;
    expect(s.length).toBeLessThan(600);
    expect(s).toContain('[truncated]');
  });

  it('errCode gives an errno code or the class name, never the message', () => {
    expect(errCode(Object.assign(new Error('/secret/path'), { code: 'ENOENT' }))).toBe('ENOENT');
    expect(errCode(new RangeError('x'))).toBe('RangeError');
    expect(errCode('str')).toBe('non_error');
  });
});
