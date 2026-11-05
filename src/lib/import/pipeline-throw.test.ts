import { describe, expect, it, vi } from 'vitest';

vi.mock('./normalize', () => ({
  normalizeRecipe: () => {
    throw new RangeError('boom');
  },
}));

import { runImport } from './pipeline';

describe('runImport: unexpected parse errors (F1)', () => {
  const page =
    '<script type="application/ld+json">{"@type":"Recipe","name":"A","recipeIngredient":["1 egg"]}</script>';

  it('url path returns failed and logs instead of throwing', async () => {
    const log = vi.fn();
    const r = await runImport(
      { url: 'https://example.com/a' },
      {
        log,
        safeFetch: async () => ({
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: new TextEncoder().encode(page),
          finalUrl: 'https://example.com/a',
        }),
      },
    );
    expect(r).toMatchObject({ status: 'failed', error_code: 'no_recipe' });
    expect(log).toHaveBeenCalled();
  });

  it('paste path returns failed instead of throwing', async () => {
    const r = await runImport({ text: page });
    expect(r).toMatchObject({ status: 'failed', error_code: 'no_recipe' });
  });
});
