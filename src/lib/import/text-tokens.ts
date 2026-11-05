// Tokenizer and singularizer for the auto-mapper. Single-pass scanners only: no regex is
// built from input and none runs over whole inputs. Pure and linear in the text length.

import { pattern } from './map-patterns';

/** One character test per code point; constant pattern, never built from input. */
const UNICODE_WORD_CHAR = pattern('unicode-word-char', /^[\p{L}\p{N}\p{M}]$/u);

export type Token = {
  /** Lowercase NFKC word, apostrophes and zero-width characters removed. */
  w: string;
  /** Character offset into `Tokenized.text`. */
  start: number;
  /** Sentence index (breaks at . ! ? ; and newlines). */
  sent: number;
  /** Clause index (breaks at commas and colons). */
  clause: number;
};

export type Tokenized = {
  /** The NFKC-lowercased text that `Token.start` indexes into. */
  text: string;
  tokens: Token[];
  /** True when tokens beyond `maxTokens` were dropped. */
  truncated: boolean;
};

const isAsciiWord = (c: number): boolean =>
  (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || (c >= 65 && c <= 90);

function isWordChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  if (c < 128) return isAsciiWord(c);
  return UNICODE_WORD_CHAR.test(ch);
}

const isIgnorable = (ch: string): boolean =>
  ch === "'" || ch === '’' || ch === '​' || ch === '‌' || ch === '‍' || ch === '﻿';

/**
 * Mark balanced parenthetical spans in one pass with a depth counter. An unclosed "(" or a
 * stray ")" removes nothing: the text around it stays. Returns a per-character mask
 * (1 = inside a balanced span) built from a difference array, so nesting stays linear.
 */
function parentheticalMask(s: string): Uint8Array {
  const n = s.length;
  const diff = new Int32Array(n + 1);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 40) stack.push(i);
    else if (ch === 41 && stack.length > 0) {
      const open = stack.pop() as number;
      diff[open]! += 1;
      diff[i + 1]! -= 1;
    }
  }
  const mask = new Uint8Array(n);
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += diff[i]!;
    mask[i] = run > 0 ? 1 : 0;
  }
  return mask;
}

/** Remove balanced parenthetical spans (replaced by one space). Linear, never throws. */
export function stripParentheticals(text: string): string {
  const s = String(text);
  const mask = parentheticalMask(s);
  let out = '';
  let inSpan = false;
  for (let i = 0; i < s.length; i++) {
    if (mask[i]) {
      if (!inSpan) out += ' ';
      inSpan = true;
    } else {
      inSpan = false;
      out += s[i];
    }
  }
  return out;
}

export function tokenizeDetailed(raw: string, maxTokens = Infinity): Tokenized {
  const text = String(raw).normalize('NFKC').toLowerCase();
  const mask = parentheticalMask(text);
  const tokens: Token[] = [];
  let word = '';
  let wordStart = 0;
  let sent = 0;
  let clause = 0;
  let truncated = false;

  const flush = () => {
    if (word === '') return;
    if (tokens.length >= maxTokens) truncated = true;
    else tokens.push({ w: word, start: wordStart, sent, clause });
    word = '';
  };

  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    const at = i;
    i += ch.length;
    if (mask[at]) {
      flush();
      continue;
    }
    if (isIgnorable(ch)) continue;
    if (isWordChar(ch)) {
      if (word === '') wordStart = at;
      word += ch;
      continue;
    }
    flush();
    if (ch === '.' || ch === '!' || ch === '?' || ch === ';') {
      const next = text[i];
      if (next === undefined || next === ' ' || next === '\n' || next === '\t' || next === '\r') {
        sent++;
        clause = 0;
      }
    } else if (ch === '\n') {
      sent++;
      clause = 0;
    } else if (ch === ',' || ch === ':') {
      clause++;
    }
  }
  flush();
  return { text, tokens, truncated };
}

/** Plain word list (lowercase, parentheticals removed, apostrophes dropped). */
export function tokenize(text: string): string[] {
  return tokenizeDetailed(text).tokens.map((t) => t.w);
}

// ---------------------------------------------------------------------------------------
// Singularization (tasklist G6): a small rule list with exceptions, not a stemmer.

const UNCHANGED = new Set([
  'molasses',
  'couscous',
  'hummus',
  'asparagus',
  'swiss',
  'lemongrass',
  'citrus',
  'octopus',
  'hibiscus',
  'watercress',
  'cress',
  'brussels',
  'oats',
  'grits',
  'greens',
  'bitters',
  'sprinkles',
]);

const IRREGULAR: Record<string, string> = {
  leaves: 'leaf',
  loaves: 'loaf',
  halves: 'half',
  knives: 'knife',
  calves: 'calf',
  cookies: 'cookie',
  brownies: 'brownie',
  smoothies: 'smoothie',
  veggies: 'veggie',
  calories: 'calorie',
  pies: 'pie',
  ties: 'tie',
  cheeses: 'cheese',
  mice: 'mouse',
  geese: 'goose',
  feet: 'foot',
};

export function singularize(word: string): string {
  const w = word;
  if (w.length <= 3) return w;
  if (UNCHANGED.has(w)) return w;
  const irr = IRREGULAR[w];
  if (irr !== undefined) return irr;
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (w.endsWith('sses') || w.endsWith('xes') || w.endsWith('ches') || w.endsWith('shes')) {
    return w.slice(0, -2);
  }
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}
