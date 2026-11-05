import { describe, expect, it, vi } from 'vitest';
import { ImportError } from './errors';
import { runImport } from './pipeline';
import type { SafeFetchOptions, SafeFetchResult } from './safe-fetch';

const enc = new TextEncoder();
const RECIPE = {
  '@type': 'Recipe',
  name: 'Pancakes',
  recipeIngredient: ['2 eggs', '1 cup flour'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Mix. ' },
    { '@type': 'HowToStep', text: 'Fry.' },
  ],
  prepTime: 'PT10M',
};
const html = (node: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(node)}</script></head><body></body></html>`;
const ok = (body: string, ct = 'text/html; charset=utf-8'): SafeFetchResult => ({
  status: 200,
  headers: { 'content-type': ct },
  body: enc.encode(body),
  finalUrl: 'https://example.com/final',
});
const fetchStub = (r: SafeFetchResult | Error) =>
  vi.fn<(url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>>(async () => {
    if (r instanceof Error) throw r;
    return r;
  });

describe('runImport: URL path', () => {
  it('fetch -> extract -> normalize gives a needs_review draft with static method', async () => {
    const f = fetchStub(ok(html(RECIPE)));
    const r = await runImport(
      { url: 'http://Example.com/pancakes/?utm_source=x#c' },
      { safeFetch: f },
    );
    expect(r).toMatchObject({ status: 'needs_review', method: 'static', error_code: null });
    expect(r.draft?.title).toBe('Pancakes');
    expect(r.draft?.view_mode).toBe('list');
    expect(r.draft?.source_url).toBe('https://example.com/pancakes');
    expect(r.source_url).toBe('https://example.com/pancakes');
    expect(r.raw_html).toContain('ld+json');
    // The original (not normalized) URL is what gets fetched.
    expect(f.mock.calls[0]![0]).toBe('http://Example.com/pancakes/?utm_source=x#c');
  });

  it('forwards fetch options (fixture seam) to safeFetch', async () => {
    const f = fetchStub(ok(html(RECIPE)));
    await runImport(
      { url: 'https://example.com/a' },
      { safeFetch: f, fetchOptions: { allowLocal: true } },
    );
    expect(f.mock.calls[0]![1]).toEqual({ allowLocal: true });
  });

  it.each([
    'blocked',
    'private_address',
    'timeout',
    'invalid_url',
    'too_large',
    'fetch_failed',
  ] as const)('passes %s through from safe-fetch as a failed result', async (code) => {
    const r = await runImport(
      { url: 'https://example.com/a' },
      { safeFetch: fetchStub(new ImportError(code)) },
    );
    expect(r).toMatchObject({ status: 'failed', method: 'static', error_code: code, draft: null });
  });

  it('maps an unexpected fetch exception to fetch_failed without leaking it', async () => {
    const log = vi.fn();
    const r = await runImport(
      { url: 'https://example.com/a' },
      { safeFetch: fetchStub(new Error('boom 10.0.0.1')), log },
    );
    expect(r.error_code).toBe('fetch_failed');
    expect(JSON.stringify(r)).not.toContain('10.0.0.1');
    expect(log).toHaveBeenCalled();
  });

  it('rejects a bad url before fetching', async () => {
    const f = fetchStub(ok(''));
    for (const url of ['nope', 'javascript:alert(1)', 'https://u:p@example.com/', '']) {
      expect((await runImport({ url }, { safeFetch: f })).error_code).toBe('invalid_url');
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('page without a Recipe, and a Recipe without steps, are no_recipe (no partial draft)', async () => {
    const a = await runImport(
      { url: 'https://example.com/a' },
      { safeFetch: fetchStub(ok('<html><body>JS only</body></html>')) },
    );
    expect(a).toMatchObject({ status: 'failed', error_code: 'no_recipe', draft: null });
    const b = await runImport(
      { url: 'https://example.com/a' },
      { safeFetch: fetchStub(ok(html({ ...RECIPE, recipeInstructions: [] }))) },
    );
    expect(b).toMatchObject({ status: 'failed', error_code: 'no_recipe', draft: null });
  });

  it('decodes the charset from the content type', async () => {
    const latin = Uint8Array.from(Buffer.from(html({ ...RECIPE, name: 'Crème' }), 'latin1'));
    const r = await runImport(
      { url: 'https://example.com/a' },
      {
        safeFetch: fetchStub({
          ...ok(''),
          body: latin,
          headers: { 'content-type': 'text/html; charset=iso-8859-1' },
        }),
      },
    );
    expect(r.draft?.title).toBe('Crème');
  });

  it('survives an unknown charset label', async () => {
    const r = await runImport(
      { url: 'https://example.com/a' },
      { safeFetch: fetchStub(ok(html(RECIPE), 'text/html; charset=bogus-9')) },
    );
    expect(r.status).toBe('needs_review');
  });
});

describe('runImport: paste path', () => {
  it('never calls the network, for html, json-ld or plain text', async () => {
    const f = fetchStub(ok(''));
    const a = await runImport({ text: html(RECIPE) }, { safeFetch: f });
    const b = await runImport({ text: JSON.stringify(RECIPE) }, { safeFetch: f });
    const c = await runImport(
      { text: 'Pancakes\nIngredients\n2 eggs\nMethod\nFry' },
      { safeFetch: f },
    );
    for (const r of [a, b, c]) {
      expect(r).toMatchObject({ status: 'needs_review', method: 'paste', source_url: null });
      expect(r.draft?.source_url ?? null).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('text without a recipe is no_recipe with method paste', async () => {
    const r = await runImport({ text: 'hello there' });
    expect(r).toMatchObject({ status: 'failed', method: 'paste', error_code: 'no_recipe' });
  });

  it('sanitizes pasted markup', async () => {
    // `<\/` is a valid JSON escape for `</`, so the markup survives inside the script block.
    const page = html({ ...RECIPE, name: '<script>x()</script>Pie' }).replace(
      /<\/(?=script>Pie)/g,
      '<\\/',
    );
    const r = await runImport({ text: page });
    expect(r.draft?.title).toBe('Pie');
  });
});

describe('runImport: never throws (F1)', () => {
  const N = 200_000;
  // JSON.stringify would overflow itself, so build the nested payload by hand.
  const deepPage = () =>
    '<script type="application/ld+json">{"@type":"Recipe","name":' +
    '{"name":'.repeat(N) +
    '"x"' +
    '}'.repeat(N) +
    ',"recipeIngredient":["1 egg"],"recipeInstructions":["Mix."]}</script>';

  it('deeply nested page recipe resolves as a failed result', async () => {
    const r = await runImport(
      { url: 'https://example.com/a' },
      { safeFetch: fetchStub(ok(deepPage())) },
    );
    expect(r.status).toBe('failed');
    expect(r.error_code).toBe('no_recipe');
  });

  it('deeply nested paste resolves as a failed result', async () => {
    const r = await runImport({ text: deepPage() });
    expect(r.status).toBe('failed');
  });
});
