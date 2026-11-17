import { describe, expect, it } from 'vitest';
import { findUnsafeStructure, MAX_JSON_DEPTH, parseBackupJson } from './parse';

describe('parseBackupJson', () => {
  it('parses plain JSON', () => {
    expect(parseBackupJson('{"a":[1,{"b":null}]}')).toEqual({
      ok: true,
      value: { a: [1, { b: null }] },
    });
  });
  it('strips a BOM', () => {
    expect(parseBackupJson('﻿{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('rejects syntax errors without throwing', () => {
    expect(parseBackupJson('{nope')).toEqual({
      ok: false,
      code: 'backup_invalid',
      reason: 'syntax',
    });
    expect(parseBackupJson('')).toMatchObject({ ok: false, reason: 'syntax' });
  });
  it.each([
    ['__proto__ top level', '{"__proto__":{"x":1}}'],
    ['__proto__ nested', '{"a":{"b":[{"__proto__":{}}]}}'],
    ['constructor', '{"recipes":[{"constructor":{"prototype":{}}}]}'],
    ['prototype', '{"a":{"prototype":1}}'],
    ['escaped key', '{"\\u005f_proto__":{}}'],
    ['in array of objects, last', '[{"a":1},{"a":2},{"__proto__":1}]'],
  ])('rejects forbidden key: %s', (_n, text) => {
    expect(parseBackupJson(text)).toEqual({
      ok: false,
      code: 'backup_invalid',
      reason: 'forbidden_key',
    });
  });
  it('allows the words as values and inside strings', () => {
    expect(parseBackupJson('{"a":"__proto__","b":"{\\"constructor\\":1}"}').ok).toBe(true);
  });
  it('does not pollute Object.prototype', () => {
    parseBackupJson('{"__proto__":{"polluted":true}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects deep nesting by text before recursion', () => {
    const n = MAX_JSON_DEPTH + 1;
    expect(parseBackupJson('['.repeat(n) + ']'.repeat(n))).toMatchObject({
      ok: false,
      reason: 'too_deep',
    });
  });
  it('rejects absurd nesting without a stack overflow', () => {
    const n = 200_000;
    expect(parseBackupJson('['.repeat(n) + ']'.repeat(n))).toMatchObject({
      ok: false,
      reason: 'too_deep',
    });
  });
  it('accepts nesting exactly at the cap', () => {
    const n = MAX_JSON_DEPTH;
    expect(parseBackupJson('['.repeat(n) + ']'.repeat(n)).ok).toBe(true);
  });
  it('ignores brackets and escaped quotes inside strings when measuring depth', () => {
    const s = JSON.stringify({ a: '['.repeat(500), b: 'x"[[[[' });
    expect(parseBackupJson(s).ok).toBe(true);
  });
});

describe('findUnsafeStructure (already-parsed values)', () => {
  it('finds an own __proto__ key created by JSON.parse', () => {
    expect(findUnsafeStructure(JSON.parse('{"x":{"__proto__":1}}'))).toBe('forbidden_key');
  });
  it('finds a constructor key set directly', () => {
    expect(findUnsafeStructure({ a: [{ constructor: 1 }] })).toBe('forbidden_key');
  });
  it('bounds depth of live objects', () => {
    let o: unknown = {};
    for (let i = 0; i < MAX_JSON_DEPTH + 5; i++) o = { o };
    expect(findUnsafeStructure(o)).toBe('too_deep');
  });
  it('survives a cycle', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(findUnsafeStructure(a)).toBeNull();
  });
  it('is quiet for clean values', () => {
    expect(findUnsafeStructure({ a: [1, 'x', null, { b: true }] })).toBeNull();
    expect(findUnsafeStructure(5)).toBeNull();
  });
});
