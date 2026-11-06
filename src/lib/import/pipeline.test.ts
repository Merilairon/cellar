import { describe, expect, it, vi } from 'vitest';
import { ImportError } from './errors';
import type { Headless } from './headless-client';
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
    // Stored URL keeps the entered scheme (Q3); the job/comparison key is the https form.
    expect(r.draft?.source_url).toBe('http://example.com/pancakes');
    expect(r.source_url).toBe('https://example.com/pancakes');
    expect(r.raw_html).toContain('ld+json');
    // The original (not normalized) URL is what gets fetched.
    expect(f.mock.calls[0]![0]).toBe('http://Example.com/pancakes/?utm_source=x#c');
  });

  it('resolves a relative cover URL against the final URL after redirects (m1)', async () => {
    const f = fetchStub({
      ...ok(html({ ...RECIPE, image: '/img/p.jpg' })),
      finalUrl: 'https://cdn.example.org/moved/pancakes',
    });
    const r = await runImport({ url: 'https://short.example.com/x' }, { safeFetch: f });
    expect(r.draft?.cover_image_url).toBe('https://cdn.example.org/img/p.jpg');
    // The stored source URL is still what the user entered.
    expect(r.draft?.source_url).toBe('https://short.example.com/x');
  });

  it('keeps the entered http scheme in the draft and the https comparison key in the job', async () => {
    const r = await runImport(
      { url: 'http://Example.com/p/?utm_source=x' },
      { safeFetch: fetchStub(ok(html(RECIPE))) },
    );
    expect(r.draft?.source_url).toBe('http://example.com/p');
    expect(r.source_url).toBe('https://example.com/p');
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

describe('runImport: headless fallback (G4 trigger table)', () => {
  const URL_IN = { url: 'https://example.com/r' };
  const rendered = (body: string, finalUrl = 'https://example.com/rendered') => ({
    html: body,
    finalUrl,
    status: 200,
  });
  const headlessOf = (
    r: Awaited<ReturnType<Headless['render']>> | Error | 'throw',
    enabled = true,
  ) => {
    const render = vi.fn<Headless['render']>(async () => {
      if (r === 'throw') throw new Error('kaboom');
      if (r instanceof Error) throw r;
      return r;
    });
    return { h: { enabled, render } satisfies Headless, render };
  };
  const NO_RECIPE_PAGE = '<html><body><div id="app"></div></body></html>';

  it('no Recipe node + headless ok => method headless draft, mapping attached, headless_used', async () => {
    const { h, render } = headlessOf(rendered(html(RECIPE)));
    const r = await runImport(URL_IN, { safeFetch: fetchStub(ok(NO_RECIPE_PAGE)), headless: h });
    expect(r).toMatchObject({
      status: 'needs_review',
      method: 'headless',
      error_code: null,
      headless: 'used',
      source_url: 'https://example.com/r',
    });
    expect(r.draft?.title).toBe('Pancakes');
    expect(r.draft?.mapping).toBeTruthy();
    expect(r.warnings).toContain('headless_used');
    expect(r.raw_html).toContain('application/ld+json'); // rendered DOM
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('https://example.com/r');
  });

  it('static 403 (and 429, 401) + headless ok => headless draft', async () => {
    for (let i = 0; i < 3; i++) {
      const { h, render } = headlessOf(rendered(html(RECIPE)));
      const r = await runImport(URL_IN, {
        safeFetch: fetchStub(new ImportError('blocked')),
        headless: h,
      });
      expect(r).toMatchObject({ status: 'needs_review', method: 'headless' });
      expect(render).toHaveBeenCalledTimes(1);
    }
  });

  it('headless disabled => original static error plus unavailable hint, no call', async () => {
    const { h, render } = headlessOf(rendered('x'), false);
    const a = await runImport(URL_IN, { safeFetch: fetchStub(ok(NO_RECIPE_PAGE)), headless: h });
    expect(a).toMatchObject({
      status: 'failed',
      method: 'static',
      error_code: 'no_recipe',
      headless: 'unavailable',
    });
    const b = await runImport(URL_IN, {
      safeFetch: fetchStub(new ImportError('blocked')),
      headless: h,
    });
    expect(b).toMatchObject({ error_code: 'blocked', headless: 'unavailable' });
    // no handle at all behaves the same
    const c = await runImport(URL_IN, { safeFetch: fetchStub(ok(NO_RECIPE_PAGE)) });
    expect(c).toMatchObject({ error_code: 'no_recipe', headless: 'unavailable' });
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'timeout', 'private_address', 'too_large', 'fetch_failed'] as const)(
    'headless error %s is surfaced as that code',
    async (code) => {
      const { h } = headlessOf(new ImportError(code));
      const r = await runImport(URL_IN, { safeFetch: fetchStub(ok(NO_RECIPE_PAGE)), headless: h });
      expect(r).toMatchObject({ status: 'failed', method: 'headless', error_code: code });
      expect(r.draft).toBeNull();
    },
  );

  it('headless_unavailable error and an unexpected throw both map to headless_unavailable', async () => {
    for (const x of [new ImportError('headless_unavailable'), 'throw' as const]) {
      const { h } = headlessOf(x);
      const r = await runImport(URL_IN, { safeFetch: fetchStub(ok(NO_RECIPE_PAGE)), headless: h });
      expect(r).toMatchObject({
        status: 'failed',
        error_code: 'headless_unavailable',
        headless: 'unavailable',
      });
    }
  });

  it('rendered page without a recipe => no_recipe, headless used', async () => {
    const { h } = headlessOf(rendered(NO_RECIPE_PAGE));
    const r = await runImport(URL_IN, { safeFetch: fetchStub(ok(NO_RECIPE_PAGE)), headless: h });
    expect(r).toMatchObject({
      status: 'failed',
      method: 'headless',
      error_code: 'no_recipe',
      headless: 'used',
    });
  });

  it('headless is attempted at most once per job', async () => {
    const { h, render } = headlessOf(rendered(NO_RECIPE_PAGE));
    await runImport(URL_IN, { safeFetch: fetchStub(ok(NO_RECIPE_PAGE)), headless: h });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('never for paste', async () => {
    const { h, render } = headlessOf(rendered(html(RECIPE)));
    await runImport({ text: 'nothing recipe-like here' }, { headless: h });
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['invalid_url', 'private_address', 'too_large', 'timeout', 'fetch_failed'] as const)(
    'static %s never triggers headless',
    async (code) => {
      const { h, render } = headlessOf(rendered(html(RECIPE)));
      const r = await runImport(URL_IN, {
        safeFetch: fetchStub(new ImportError(code)),
        headless: h,
      });
      expect(r).toMatchObject({ status: 'failed', method: 'static', error_code: code });
      expect(r.headless ?? null).toBeNull();
      expect(render).not.toHaveBeenCalled();
    },
  );

  it('an unparsable entered URL never triggers headless', async () => {
    const { h, render } = headlessOf(rendered(html(RECIPE)));
    const r = await runImport({ url: 'not a url' }, { headless: h });
    expect(r.error_code).toBe('invalid_url');
    expect(render).not.toHaveBeenCalled();
  });

  it('a Recipe node that normalizes to nothing does not trigger headless', async () => {
    const { h, render } = headlessOf(rendered(html(RECIPE)));
    const r = await runImport(URL_IN, {
      safeFetch: fetchStub(ok(html({ '@type': 'Recipe', name: 'Empty' }))),
      headless: h,
    });
    expect(r).toMatchObject({ status: 'failed', method: 'static', error_code: 'no_recipe' });
    expect(render).not.toHaveBeenCalled();
  });

  it('static success never calls headless', async () => {
    const { h, render } = headlessOf(rendered(html(RECIPE)));
    const r = await runImport(URL_IN, { safeFetch: fetchStub(ok(html(RECIPE))), headless: h });
    expect(r).toMatchObject({ status: 'needs_review', method: 'static' });
    expect(render).not.toHaveBeenCalled();
  });

  it('mapper is deterministic on headless HTML and resolves relative covers against finalUrl', async () => {
    const withImg = html({ ...RECIPE, image: '/img/p.jpg' });
    const a = await runImport(URL_IN, {
      safeFetch: fetchStub(ok(NO_RECIPE_PAGE)),
      headless: headlessOf(rendered(withImg, 'https://cdn.example.org/page')).h,
    });
    const b = await runImport(URL_IN, {
      safeFetch: fetchStub(ok(NO_RECIPE_PAGE)),
      headless: headlessOf(rendered(withImg, 'https://cdn.example.org/page')).h,
    });
    expect(JSON.stringify(a.draft)).toBe(JSON.stringify(b.draft));
    expect(JSON.stringify(a.draft)).toContain('https://cdn.example.org/img/p.jpg');
  });
});
