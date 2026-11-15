import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import type { PublicRecipe } from '@/lib/recipes/public';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import { apiFromInput } from '../fixtures';
import { PublicRecipeView } from './PublicRecipeView';

function toPublic(over: Partial<PublicRecipe> = {}): PublicRecipe {
  const a = apiFromInput(SAMPLE_SKILLET_COOKIES);
  return {
    title: a.title,
    description: a.description,
    servings: a.servings,
    servings_label: a.servings_label,
    prep_minutes: a.prep_minutes,
    cook_minutes: a.cook_minutes,
    source_url: a.source_url,
    source_name: a.source_name,
    view_mode: a.view_mode,
    tags: a.tags,
    sections: a.sections,
    ...over,
  };
}

const render = (recipe: PublicRecipe) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <PublicRecipeView recipe={recipe} />
    </NextIntlClientProvider>,
  );
const visible = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('PublicRecipeView', () => {
  const html = render(
    toPublic({
      tags: ['dessert', 'cookies'],
      source_url: 'https://www.bbcgoodfood.com/recipes/cookie',
      source_name: 'BBC Good Food',
    }),
  );
  const text = visible(html);

  it('shows title, banner, tags as plain text, controls and footer', () => {
    expect(html).toContain('<h1');
    expect(text).toContain(SAMPLE_SKILLET_COOKIES.title);
    expect(text).toContain(
      'Recipe from BBC Good Food. Shared read-only via Cellar, not affiliated with the source.',
    );
    expect(html).toContain('href="https://www.bbcgoodfood.com/recipes/cookie"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(text).toContain('Shared read-only link from a private recipe book.');
    // F1: tags are not links, source appears once (banner only, no "Source:" meta line).
    expect(html).not.toContain('/recipes?tag=');
    expect(text).toContain('dessert');
    expect(text).not.toMatch(/Source:/);
    // Scale and unit controls start in metric, so the button offers US units.
    expect(text).toContain('Show in US units');
    expect(html).toMatch(/aria-label="View"|role="group"/);
  });

  it('has none of the owner, edit or private controls and strings', () => {
    // Controls: the only buttons are scale presets, unit, reset and the grid/list toggle.
    const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)]
      .filter((m) => !m[1].includes('data-step-id'))
      .map((m) => m[2].replace(/<[^>]+>/g, ''));
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) {
      expect(b).toMatch(/^(1\/2x|1x|2x|Custom|Show in US units|Reset|Grid|List)$/);
    }
    for (const forbidden of [
      /\bEdit\b/,
      /\bDelete\b/,
      /Save a copy/i,
      /Convert/i,
      /\bShare\b/,
      /Notes?\b/,
      /rating|Rate this|stars/i,
      /Photos?/i,
    ]) {
      expect(text).not.toMatch(forbidden);
    }
    expect(html).not.toContain('<img');
    expect(html).not.toContain('/api/');
    expect(html).not.toContain('href="/');
  });

  it('banner: name only (no URL) is plain text; host only gets a labelled link; none renders nothing', () => {
    const nameOnly = render(toPublic({ source_url: null, source_name: 'Grandma' }));
    expect(visible(nameOnly)).toContain('Recipe from Grandma.');
    expect(nameOnly).not.toContain('<a ');

    const hostOnly = render(toPublic({ source_url: 'https://example.com/x/y', source_name: null }));
    expect(visible(hostOnly)).toContain('Recipe from example.com');
    expect(hostOnly).toContain('aria-label="Source: example.com"');

    const unsafe = render(toPublic({ source_url: 'javascript:alert(1)', source_name: 'Evil' }));
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).not.toContain('<a ');

    const none = render(toPublic({ source_url: null, source_name: null }));
    expect(visible(none)).not.toContain('Recipe from');
  });

  it('a list-only recipe disables Grid with the reader note', () => {
    const list = render(toPublic({ view_mode: 'list' }));
    expect(list).toMatch(/<button[^>]*disabled[^>]*>Grid<\/button>/);
    expect(visible(list)).toContain(
      'This recipe has no grid layout yet, so it is shown as a list.',
    );
  });

  it('renders on the server without touching storage or the network', () => {
    const g = globalThis as { localStorage?: unknown; fetch?: unknown };
    const realFetch = g.fetch;
    g.fetch = () => {
      throw new Error('network');
    };
    try {
      expect(() => render(toPublic())).not.toThrow();
    } finally {
      g.fetch = realFetch;
    }
  });
});
