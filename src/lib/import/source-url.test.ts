import { describe, expect, it } from 'vitest';
import {
  normalizeSourceUrl as n,
  sourceUrlCandidates as candidates,
  storedSourceUrl as stored,
} from './source-url';

describe('normalizeSourceUrl', () => {
  it.each([
    ['https://example.com/pie', 'https://example.com/pie'],
    ['HTTP://Example.COM/Pie', 'https://example.com/Pie'], // host lowercased, path case kept, http == https
    ['https://example.com/pie/', 'https://example.com/pie'],
    ['https://example.com/pie///', 'https://example.com/pie'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
    ['https://example.com/pie#reviews', 'https://example.com/pie'],
    ['https://example.com/pie?utm_source=x&utm_medium=y', 'https://example.com/pie'],
    ['https://example.com/pie?fbclid=abc&gclid=def', 'https://example.com/pie'],
    ['https://example.com/pie?UTM_Campaign=x&id=5', 'https://example.com/pie?id=5'],
    ['https://example.com/pie?b=2&a=1', 'https://example.com/pie?a=1&b=2'],
    ['https://example.com:443/pie', 'https://example.com/pie'],
    ['http://example.com:80/pie', 'https://example.com/pie'],
    ['https://www.example.com/pie', 'https://www.example.com/pie'], // www kept
    ['  https://example.com/pie  ', 'https://example.com/pie'],
  ])('%s -> %s', (i, o) => expect(n(i)).toBe(o));

  it('treats variants as equal', () => {
    expect(n('http://example.com/pie/?utm_source=a#x')).toBe(n('https://example.com/pie'));
  });

  it.each([
    '',
    'nope',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://a.example/',
    'https://u:p@a.example/',
    null,
    5,
  ])('rejects %j', (i) => expect(n(i)).toBeNull());

  it('rejects over-long input', () => {
    expect(n('https://a.example/' + 'x'.repeat(3000))).toBeNull();
  });
});

describe('storedSourceUrl (entered scheme kept, Q3)', () => {
  it.each([
    ['http://example.com/pie', 'http://example.com/pie'],
    ['https://example.com/pie', 'https://example.com/pie'],
    ['HTTP://Example.COM/Pie/?utm_source=x&b=2&a=1#frag', 'http://example.com/Pie?a=1&b=2'],
    ['http://example.com:80/pie', 'http://example.com/pie'], // default port of its own scheme
    ['http://example.com:8080/pie', 'http://example.com:8080/pie'],
    ['http://example.com:443/pie', 'http://example.com:443/pie'], // not the http default
    ['https://www.example.com/', 'https://www.example.com'],
    ['  http://example.com/pie  ', 'http://example.com/pie'],
  ])('%s -> %s', (i, o) => expect(stored(i)).toBe(o));

  it.each(['', 'nope', 'javascript:alert(1)', 'ftp://a.example/', 'https://u:p@a.example/', null])(
    'rejects %j like the comparison key',
    (i) => expect(stored(i)).toBeNull(),
  );

  it('both schemes of one page share the comparison key', () => {
    expect(n(stored('http://example.com/pie/?utm_source=a'))).toBe(
      n(stored('https://example.com/pie')),
    );
  });
});

describe('sourceUrlCandidates (every stored form that shares the comparison key)', () => {
  it('covers both schemes for a plain URL', () => {
    expect(candidates('https://site.example/pie')).toEqual([
      'https://site.example/pie',
      'http://site.example/pie',
      'https://site.example:80/pie',
      'http://site.example:443/pie',
    ]);
    expect(candidates('http://site.example/pie/')).toEqual(candidates('https://site.example/pie'));
  });

  it('includes a stored non-default port of the other scheme (:443 on http, :80 on https)', () => {
    for (const input of [
      'http://h.example:443/x',
      'https://h.example/x',
      'https://h.example:80/x',
    ]) {
      const c = candidates(input);
      expect(c).toContain('http://h.example:443/x');
      expect(c).toContain('https://h.example:80/x');
      expect(c).toContain('https://h.example/x');
      expect(c).toContain('http://h.example/x');
    }
  });

  it('a stored form always yields a candidate list that contains it', () => {
    for (const input of [
      'http://h.example:443/x',
      'https://h.example:80/x',
      'http://a.test:8080/p?b=1&a=2',
    ]) {
      expect(candidates(input)).toContain(stored(input));
    }
  });

  it('keeps other ports on both schemes and returns [] for invalid input', () => {
    expect(candidates('https://h.example:8443/x')).toEqual([
      'https://h.example:8443/x',
      'http://h.example:8443/x',
    ]);
    expect(candidates('ftp://h.example/x')).toEqual([]);
    expect(candidates(42)).toEqual([]);
  });
});
