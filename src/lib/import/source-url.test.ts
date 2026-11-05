import { describe, expect, it } from 'vitest';
import { normalizeSourceUrl as n, storedSourceUrl as stored } from './source-url';

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
