// Pure text hygiene for everything that comes from a third-party page. Imported text is
// stored and rendered as plain text only (React escapes it); this module guarantees that
// no markup, script content, control or direction-override characters survive, and that
// work is linear in the (pre-capped) input size.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  frac13: '⅓',
  frac23: '⅔',
  times: '×',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  ccedil: 'ç',
  icirc: 'î',
  iacute: 'í',
  ocirc: 'ô',
  oacute: 'ó',
  uacute: 'ú',
  ugrave: 'ù',
  ntilde: 'ñ',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  szlig: 'ß',
  shy: '',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
};

/** Decode entities exactly once. Unknown or invalid entities are left as written. */
function decodeEntitiesOnce(s: string): string {
  return s.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,9}));/g,
    (m, dec, hex, name) => {
      if (name) return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name]! : m;
      const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      return String.fromCodePoint(cp);
    },
  );
}

// Linear-time patterns: every attempt stops at the next '<' or at end of input.
const RAW_BLOCK =
  /<(script|style|template|iframe|object|noscript)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const COMMENT = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g;
const BREAK_TAG = /<\/?(?:br|p|div|li|ul|ol|tr|h[1-6]|section|article|blockquote)\b[^<>]*>/gi;
const ANY_TAG = /<\/?[a-zA-Z!?][^<>]*>/g;

// C0/C1 controls except \t \n, bidi overrides/isolates/marks, zero-width chars, BOM, line/para separators.
const BAD_CHARS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function stripTags(s: string, breakWith: string): string {
  let prev: string;
  let cur = s;
  // Repeat so that `<scr<script></script>ipt>` style nesting cannot reassemble a tag.
  for (let i = 0; i < 5; i++) {
    prev = cur;
    cur = cur
      .replace(COMMENT, ' ')
      .replace(RAW_BLOCK, ' ')
      .replace(BREAK_TAG, breakWith)
      .replace(ANY_TAG, '');
    if (cur === prev) break;
  }
  return cur;
}

export type SanitizeOptions = { maxLen: number; multiline?: boolean };

export function sanitizeText(input: unknown, opts: SanitizeOptions): string {
  if (typeof input !== 'string') return '';
  const { maxLen, multiline = false } = opts;
  // Bound the work before any regex runs; the output is capped at maxLen anyway.
  let s = input.slice(0, Math.min(Math.max(maxLen * 8, 1000), 400_000));
  s = s.replace(BAD_CHARS, (c) => (c === '\u2028' || c === '\u2029' ? '\n' : ''));
  const brk = multiline ? '\n' : ' ';
  s = stripTags(s, brk); // tags in the raw markup
  s = decodeEntitiesOnce(s); // a single decode, never recursive
  s = stripTags(s, brk); // tags that only appeared after decoding (&lt;script&gt;)
  s = s.replace(BAD_CHARS, ''); // numeric entities can reintroduce controls
  s = s.replace(/\u00A0/g, ' ');
  if (multiline) {
    s = s
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    s = s.replace(/\s+/g, ' ').trim();
  }
  return capCodePoints(s, maxLen).trim();
}

function capCodePoints(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1); // do not cut a surrogate pair
  return out;
}

/** http(s) URL only, no credentials, canonical form; null otherwise. Relative URLs need `base`. */
export function sanitizeUrl(input: unknown, base?: string): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.replace(BAD_CHARS, '').trim();
  if (!raw || raw.length > 2000) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
