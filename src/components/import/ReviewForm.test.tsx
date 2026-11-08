import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Draft } from '@/lib/import/normalize';
import { ReviewForm } from './ReviewForm';
import { warningMessage } from './warnings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}));

const draft = {
  title: '<script>alert(1)</script>Soup',
  description: null,
  servings: 2,
  servings_label: null,
  prep_minutes: null,
  cook_minutes: null,
  source_url: 'https://example.com/soup',
  source_name: '<img src=x onerror=alert(1)>',
  tags: ['<b>tag</b>'],
  cover_image_url: 'https://example.com/cover.jpg',
  sections: [
    {
      title: null,
      ingredients: [{ name: 'water', raw_text: '1 l water', display_primary: 'metric' }],
      steps: [{ kind: 'column', label: 'Boil', detail: 'Boil <script>x</script>' }],
    },
  ],
} as unknown as Draft;

const render = (duplicate: { recipe_id: string; title: string } | null, headless = false) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <ReviewForm
        jobId="J1"
        draft={draft}
        warnings={['ingredients_unparsed:2', 'weird']}
        duplicate={duplicate}
        headless={headless}
      />
    </NextIntlClientProvider>,
  );

describe('ReviewForm', () => {
  it('shows the browser note only for headless imports', () => {
    expect(render(null)).not.toContain('loaded in a browser');
    expect(render(null, true)).toContain('Page was loaded in a browser');
  });

  it('renders imported text escaped, never as markup', () => {
    const html = render(null);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>tag</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;Soup');
  });

  it('shows no confidence badge, a cover checkbox and the attribution line', () => {
    const html = render(null);
    expect(html).not.toMatch(/confidence/i);
    expect(html).toContain('Include the cover image');
    expect(html).toContain('stays attributed to its source');
    expect(html).not.toContain('example.com/cover.jpg'); // remote cover is never loaded
  });

  it('shows the duplicate banner with a link to the existing recipe', () => {
    const html = render({ recipe_id: 'R9', title: 'Old soup' });
    expect(html).toContain('href="/recipes/R9"');
    expect(html).toContain('Import anyway');
    expect(render(null)).not.toContain('Import anyway');
  });
});

describe('warningMessage', () => {
  const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`;
  it('parses the counted code and falls back for unknown codes', () => {
    expect(warningMessage(t, 'ingredients_unparsed:3')).toBe(
      'import.warning.ingredients_unparsed{"count":3}',
    );
    expect(warningMessage(t, 'whatever')).toBe('import.warning.generic');
  });
  it('an unknown code with markup in the suffix gets the generic text, never the markup', () => {
    const out = warningMessage(t, 'whatever:<img src=x onerror=alert(1)>');
    expect(out).toBe('import.warning.generic');
    expect(out).not.toContain('<');
  });
});

describe('security checkpoint', () => {
  const dirs = [__dirname, join(__dirname, '../../app/(app)/import')];
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(d, e.name))
        : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)
          ? [join(d, e.name)]
          : [],
    );
  it('import UI never uses dangerouslySetInnerHTML or reads raw_html', () => {
    for (const f of dirs.flatMap(walk)) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|raw_html/);
    }
  });
});
