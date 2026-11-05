import { describe, expect, it } from 'vitest';
import { normalizeSourceUrl as n } from './source-url';

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
