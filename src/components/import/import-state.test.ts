import { describe, expect, it } from 'vitest';
import { classifyResponse, initialState, reducer, type DialogState } from './import-state';

const run = (s: DialogState, ...a: Parameters<typeof reducer>[1][]) => a.reduce(reducer, s);

describe('import dialog state', () => {
  it('submit starts fetching for url and parsing for paste', () => {
    expect(run(initialState, { type: 'submit' }).busy).toBe('fetching');
    expect(run({ ...initialState, tab: 'paste' }, { type: 'submit' }).busy).toBe('parsing');
  });

  it('ignores a double submit and tab switches while busy', () => {
    const busy = run(initialState, { type: 'submit' });
    expect(reducer(busy, { type: 'submit' })).toBe(busy);
    expect(reducer(busy, { type: 'tab', tab: 'paste' })).toBe(busy);
  });

  it('moves to parsing, and cancel returns to idle keeping the input', () => {
    const s = run(
      { ...initialState, url: 'https://a.test/r' },
      { type: 'submit' },
      { type: 'phase', phase: 'parsing' },
    );
    expect(s.busy).toBe('parsing');
    const c = reducer(s, { type: 'cancel' });
    expect(c.busy).toBeNull();
    expect(c.url).toBe('https://a.test/r');
  });

  it.each(['blocked', 'no_recipe', 'timeout', 'fetch_failed', 'headless_unavailable'] as const)(
    'recovers to the paste tab after %s, keeping the typed URL',
    (code) => {
      const s = run(
        { ...initialState, url: 'https://a.test/r' },
        { type: 'submit' },
        { type: 'failed', failure: { kind: 'code', code } },
      );
      expect(s.tab).toBe('paste');
      expect(s.pasteFocus).toBe(1);
      expect(s.url).toBe('https://a.test/r');
      expect(s.error).toEqual({ kind: 'code', code });
    },
  );

  it.each(['invalid_url', 'private_address', 'too_large'] as const)(
    'stays on the url tab after %s',
    (code) => {
      const s = run(
        initialState,
        { type: 'submit' },
        { type: 'failed', failure: { kind: 'code', code } },
      );
      expect(s.tab).toBe('url');
      expect(s.pasteFocus).toBe(0);
    },
  );

  it('clears the error on the next submit', () => {
    const s = run(
      initialState,
      { type: 'submit' },
      { type: 'failed', failure: { kind: 'network' } },
      { type: 'submit' },
    );
    expect(s.error).toBeNull();
  });
});

describe('rendering phase and headless', () => {
  it('moves fetching to rendering, and never back', () => {
    const s = run(initialState, { type: 'submit' }, { type: 'phase', phase: 'rendering' });
    expect(s.busy).toBe('rendering');
    expect(reducer(s, { type: 'phase', phase: 'parsing' })).toBe(s);
  });
  it('keeps the headless state from the response', () => {
    expect(
      classifyResponse(
        200,
        { status: 'failed', error_code: 'no_recipe', headless: 'unavailable' },
        null,
      ),
    ).toEqual({ ok: false, failure: { kind: 'code', code: 'no_recipe', headless: 'unavailable' } });
    expect(
      classifyResponse(200, { status: 'failed', error_code: 'blocked', headless: 'bogus' }, null),
    ).toEqual({ ok: false, failure: { kind: 'code', code: 'blocked', headless: null } });
  });
});

describe('classifyResponse', () => {
  it('accepts a reviewable draft', () => {
    expect(
      classifyResponse(200, { id: 'J1', status: 'needs_review', draft: { title: 'x' } }, null),
    ).toEqual({
      ok: true,
      id: 'J1',
    });
  });
  it('maps failed jobs to their error_code', () => {
    expect(classifyResponse(200, { status: 'failed', error_code: 'too_large' }, null)).toEqual({
      ok: false,
      failure: { kind: 'code', code: 'too_large', headless: null },
    });
  });
  it('maps 429 to the retry seconds, defaulting when the header is missing', () => {
    expect(classifyResponse(429, {}, '42')).toEqual({
      ok: false,
      failure: { kind: 'rateLimited', seconds: 42 },
    });
    expect(classifyResponse(429, {}, null)).toEqual({
      ok: false,
      failure: { kind: 'rateLimited', seconds: 60 },
    });
  });
  it('treats unknown codes and other statuses as generic', () => {
    expect(classifyResponse(200, { status: 'failed', error_code: 'weird' }, null).ok).toBe(false);
    expect(classifyResponse(500, null, null)).toEqual({ ok: false, failure: { kind: 'generic' } });
  });
});
