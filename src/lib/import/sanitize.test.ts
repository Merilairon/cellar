import { describe, expect, it } from 'vitest';
import { sanitizeText, sanitizeUrl } from './sanitize';

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const one = (s: unknown, maxLen = 500) => sanitizeText(s, { maxLen });
const multi = (s: unknown, maxLen = 5000) => sanitizeText(s, { maxLen, multiline: true });

describe('sanitizeText', () => {
  it('strips script and style elements including their content', () => {
    expect(one('Hello <script>alert(1)</script>world')).toBe('Hello world');
    expect(one('A<style>body{display:none}</style>B')).toBe('A B');
    expect(one('x <SCRIPT type="text/javascript">evil()</SCRIPT > y')).toBe('x y');
  });

  it('drops an unterminated script block to the end', () => {
    expect(one('before <script>alert(1) and more text')).toBe('before');
  });

  it('strips event-handler tags', () => {
    expect(one('<img src=x onerror=alert(1)>Pie')).toBe('Pie');
    expect(one('<a href="javascript:alert(1)" onclick="x()">link</a>')).toBe('link');
  });

  it('strips entity-encoded tags (decoded once, then stripped)', () => {
    expect(one('&lt;script&gt;alert(1)&lt;/script&gt;ok')).toBe('ok');
    expect(one('&lt;b&gt;bold&lt;/b&gt;')).toBe('bold');
  });

  it('does not double-decode', () => {
    expect(one('Tom &amp;amp; Jerry')).toBe('Tom &amp; Jerry');
    expect(one('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('decodes numeric and common named entities', () => {
    expect(one('Mom&#39;s &quot;best&quot; &amp; 350&deg;F &#x2013; done')).toBe(
      'Mom\'s "best" & 350°F – done',
    );
  });

  it('leaves unknown or invalid entities as written and drops NUL entities', () => {
    expect(one('&bogus; &#0; &#xD800; &#1114112;')).toBe('&bogus;');
  });

  it('cannot reassemble a tag from nested fragments', () => {
    expect(one('<scr<script></script>ipt>alert(1)</scr</script>ipt>')).not.toMatch(/<\/?script/i);
    expect(one('<<b>script>alert(1)<</b>/script>')).not.toMatch(/<script/i);
  });

  it('strips comments and CDATA', () => {
    expect(one('a<!-- hidden <script> -->b')).toBe('a b');
    expect(one('a<![CDATA[ x ]]>b')).toBe('a b');
  });

  it('removes bidi overrides, zero-width characters and BOM', () => {
    const s = `abc${ch(0x202e)}def${ch(0x2066)}g${ch(0x200b)}h${ch(0xfeff)}i${ch(0x200f)}`;
    expect(one(s)).toBe('abcdefghi');
  });

  it('removes null bytes and other control characters', () => {
    expect(one(`a${ch(0)}b${ch(7)}c${ch(0x1b)}[31md`)).toBe('abc[31md');
  });

  it('removes controls that arrive through numeric entities', () => {
    expect(one('a&#8238;b&#x202E;c&#0;d')).toBe('abcd');
  });

  it('caps length without splitting a surrogate pair', () => {
    expect(one('x'.repeat(100_000), 50)).toHaveLength(50);
    const out = one('ab' + '\u{1F600}'.repeat(5), 3);
    expect(out).toBe('ab');
  });

  it('handles a 100 KB string quickly', () => {
    const t0 = Date.now();
    const out = sanitizeText('<b>x</b> '.repeat(20_000), { maxLen: 100_000 });
    expect(out.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('is linear on adversarial unclosed tags', () => {
    const t0 = Date.now();
    one('<a'.repeat(200_000), 1000);
    one('<script>'.repeat(100_000), 1000);
    one('<!--'.repeat(100_000), 1000);
    one('<p '.repeat(100_000), 1000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('collapses whitespace (single line) and keeps lone angle brackets as text', () => {
    expect(one('  a \n\t b  ')).toBe('a b');
    expect(one('cook < 5 min > 2')).toBe('cook < 5 min > 2');
  });

  it('multiline keeps line breaks, turns br/p into newlines and collapses blank runs', () => {
    expect(multi('one<br>two<br/>three')).toBe('one\ntwo\nthree');
    expect(multi('<p>a</p><p>b</p>')).toBe('a\n\nb');
    expect(multi('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(multi('  a  b \r\n c ')).toBe('a b\nc');
  });

  it('returns an empty string for non-strings', () => {
    for (const v of [null, undefined, 5, {}, []]) expect(one(v)).toBe('');
  });
});

describe('sanitizeUrl', () => {
  it('accepts http and https only', () => {
    expect(sanitizeUrl('https://a.example/x.jpg')).toBe('https://a.example/x.jpg');
    expect(sanitizeUrl('http://a.example/')).toBe('http://a.example/');
    for (const u of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'ftp://a/',
      'ws://a/',
    ]) {
      expect(sanitizeUrl(u)).toBeNull();
    }
  });
  it('rejects credentials, garbage, relative-without-base and long urls', () => {
    expect(sanitizeUrl('https://u:p@a.example/')).toBeNull();
    expect(sanitizeUrl('not a url')).toBeNull();
    expect(sanitizeUrl('/img/x.jpg')).toBeNull();
    expect(sanitizeUrl('https://a.example/' + 'x'.repeat(2100))).toBeNull();
    expect(sanitizeUrl(42)).toBeNull();
  });
  it('resolves relative urls against a base', () => {
    expect(sanitizeUrl('/img/x.jpg', 'https://a.example/r/1')).toBe('https://a.example/img/x.jpg');
    expect(sanitizeUrl('//cdn.example/x.jpg', 'https://a.example/')).toBe(
      'https://cdn.example/x.jpg',
    );
  });
});
