import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMicrodataRecipe } from './extract-microdata';
import { extractRecipe } from './extract-recipe';
import { normalizeRecipe } from './normalize';

const fx = (n: string) =>
  readFileSync(join(process.cwd(), 'tests/fixtures/import', `${n}.html`), 'utf8');
const wrap = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
const scope = (inner: string, type = 'https://schema.org/Recipe') =>
  wrap(`<div itemscope itemtype="${type}">${inner}</div>`);

describe('extractMicrodataRecipe fixtures', () => {
  it('basic', () => {
    const n = extractMicrodataRecipe(fx('microdata-only-basic')).node!;
    expect(n['name']).toBe('Simple Pancakes');
    expect(n['recipeIngredient']).toEqual(['200 g flour', '2 eggs', '250 ml milk']);
    expect(n['recipeInstructions']).toEqual([
      { '@type': 'HowToStep', text: 'Whisk everything.' },
      { '@type': 'HowToStep', text: 'Fry until golden.' },
    ]);
  });
  it('HowToStep scopes', () => {
    const n = extractMicrodataRecipe(fx('microdata-only-howtostep')).node!;
    expect(n['name']).toBe('Tomato Soup');
    expect(n['recipeInstructions']).toEqual([
      { '@type': 'HowToStep', text: 'Chop.' },
      { '@type': 'HowToStep', text: 'Simmer.' },
    ]);
  });
  it('output goes through normalizeRecipe unchanged', () => {
    const n = extractMicrodataRecipe(fx('microdata-only-basic')).node!;
    const r = normalizeRecipe(n, {
      sourceUrl: 'https://example.com/p',
      baseUrl: 'https://example.com/p',
    });
    expect(r.draft?.title).toBe('Simple Pancakes');
  });
});

describe('extractMicrodataRecipe properties', () => {
  it('reads meta/time/img/link values, legacy ingredients, category, author', () => {
    const n = extractMicrodataRecipe(
      scope(`
      <span itemprop="name">Stew</span>
      <meta itemprop="description" content="Hearty.">
      <img itemprop="image" src="/img/stew.jpg">
      <time itemprop="prepTime" datetime="PT10M">10 min</time>
      <meta itemprop="cookTime" content="PT1H">
      <span itemprop="recipeYield">4 servings</span>
      <span itemprop="ingredients">1 beef</span>
      <span itemprop="recipeCategory">Dinner</span>
      <span itemprop="keywords">winter, beef</span>
      <span itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Ann</span></span>
      <div itemprop="recipeInstructions">Brown the beef.\nSimmer.</div>`),
    ).node!;
    expect(n).toMatchObject({
      name: 'Stew',
      description: 'Hearty.',
      image: '/img/stew.jpg',
      prepTime: 'PT10M',
      cookTime: 'PT1H',
      recipeYield: '4 servings',
      recipeIngredient: ['1 beef'],
      recipeCategory: ['Dinner'],
      keywords: 'winter, beef',
      author: { name: 'Ann' },
    });
    expect((n['recipeInstructions'] as unknown[]).length).toBe(1);
  });
  it('HowToSection with steps', () => {
    const n = extractMicrodataRecipe(
      scope(`<span itemprop="name">Cake</span><span itemprop="recipeIngredient">flour</span>
      <div itemprop="recipeInstructions" itemscope itemtype="http://schema.org/HowToSection">
        <h3 itemprop="name">Batter</h3>
        <ol><li itemprop="itemListElement" itemscope itemtype="http://schema.org/HowToStep"><span itemprop="text">Mix.</span></li></ol>
      </div>`),
    ).node!;
    expect(n['recipeInstructions']).toEqual([
      {
        '@type': 'HowToSection',
        name: 'Batter',
        itemListElement: [{ '@type': 'HowToStep', text: 'Mix.' }],
      },
    ]);
  });
  it.each([
    'http://schema.org/Recipe',
    'https://schema.org/Recipe/',
    'HTTPS://SCHEMA.ORG/RECIPE',
    'https://www.schema.org/Recipe',
    'https://schema.org/Thing https://schema.org/Recipe',
  ])('accepts itemtype %s', (t) => {
    expect(extractMicrodataRecipe(scope('<b itemprop="name">X</b>', t)).node?.['name']).toBe('X');
  });
  it.each([
    'https://schema.org/RecipeExtra',
    'https://schema.org/Product',
    'https://evil.example/schema.org/Recipe',
    'https://schema.org.evil.example/Recipe',
    'ftp://schema.org/Recipe',
    'Recipe',
  ])('rejects itemtype %s', (t) => {
    expect(extractMicrodataRecipe(scope('<b itemprop="name">X</b>', t)).node).toBeNull();
  });
  it('a Product page has no recipe', () => {
    const r = extractRecipe(scope('<b itemprop="name">Pan</b>', 'https://schema.org/Product'));
    expect(r.node).toBeNull();
  });
  it('ignores nested scopes of other types for recipe props', () => {
    const n = extractMicrodataRecipe(
      scope(
        `<b itemprop="name">Real</b><div itemscope itemtype="https://schema.org/Review"><b itemprop="name">Review title</b><i itemprop="recipeIngredient">fake</i></div>`,
      ),
    ).node!;
    expect(n['name']).toBe('Real');
    expect(n['recipeIngredient']).toBeUndefined();
  });
  it('picks the recipe with most ingredients', () => {
    const html = wrap(
      `<div itemscope itemtype="https://schema.org/Recipe"><b itemprop="name">A</b><i itemprop="recipeIngredient">1</i></div>
       <div itemscope itemtype="https://schema.org/Recipe"><b itemprop="name">B</b><i itemprop="recipeIngredient">1</i><i itemprop="recipeIngredient">2</i></div>`,
    );
    const r = extractMicrodataRecipe(html);
    expect(r.node?.['name']).toBe('B');
    expect(r.found).toBe(2);
  });
  it('does not read script, style or comments', () => {
    const n = extractMicrodataRecipe(
      scope(`<!-- <i itemprop="recipeIngredient">commented</i> -->
      <script><i itemprop="recipeIngredient">in script</i></script>
      <style>.x{}</style><b itemprop="name">N<script>alert(1)</script></b>`),
    ).node!;
    expect(n['recipeIngredient']).toBeUndefined();
    expect(n['name']).toBe('N');
  });
  it('script text in an itemprop stays inert after normalize', () => {
    const n = extractMicrodataRecipe(
      scope(
        `<b itemprop="name">Soup &lt;script&gt;alert(1)&lt;/script&gt;</b><i itemprop="recipeIngredient">1 onion</i><p itemprop="recipeInstructions">Cook.</p>`,
      ),
    ).node!;
    const d = normalizeRecipe(n, {
      sourceUrl: 'https://example.com/',
      baseUrl: 'https://example.com/',
    }).draft;
    expect(JSON.stringify(d)).not.toContain('<script');
  });
  it('javascript: image is dropped by normalize', () => {
    const n = extractMicrodataRecipe(
      scope(
        `<b itemprop="name">S</b><i itemprop="recipeIngredient">1 onion</i><p itemprop="recipeInstructions">Cook.</p><a itemprop="image" href="javascript:alert(1)">x</a>`,
      ),
    ).node!;
    const d = normalizeRecipe(n, {
      sourceUrl: 'https://example.com/',
      baseUrl: 'https://example.com/',
    }).draft;
    expect(JSON.stringify(d)).not.toContain('javascript:');
  });
});

describe('JSON-LD wins', () => {
  const both = `<html><head><script type="application/ld+json">{"@type":"Recipe","name":"From LD","recipeIngredient":["a"]}</script></head>
    <body><div itemscope itemtype="https://schema.org/Recipe"><b itemprop="name">From microdata</b></div></body></html>`;
  it('uses JSON-LD when both exist', () => {
    expect(extractRecipe(both).node?.['name']).toBe('From LD');
  });
  it('falls back to microdata when JSON-LD has no Recipe', () => {
    const html = `<script type="application/ld+json">{"@type":"WebSite"}</script>${scope('<b itemprop="name">MD</b>')}`;
    expect(extractRecipe(html).node?.['name']).toBe('MD');
  });
  it('falls back when JSON-LD is invalid', () => {
    const html = `<script type="application/ld+json">{nope</script>${scope('<b itemprop="name">MD</b>')}`;
    expect(extractRecipe(html).node?.['name']).toBe('MD');
  });
  it('no markup, no node', () => {
    expect(extractRecipe('<p>hi</p>').node).toBeNull();
    expect(extractRecipe('').node).toBeNull();
  });
});

describe('hostile input', () => {
  it('10 000 nested itemscope', () => {
    const t = Date.now();
    const html = wrap(
      '<div itemscope itemtype="https://schema.org/Recipe"><b itemprop="name">Deep</b>' +
        '<div itemscope itemtype="https://schema.org/Thing">'.repeat(10_000),
    );
    const r = extractMicrodataRecipe(html);
    expect(r.node?.['name']).toBe('Deep');
    expect(Date.now() - t).toBeLessThan(5_000);
  });
  it('nested recipe scopes are not counted as extra recipes', () => {
    const html = wrap('<div itemscope itemtype="https://schema.org/Recipe">'.repeat(5000));
    expect(extractMicrodataRecipe(html).found).toBe(1);
  });
  it('enormous itemprop text is truncated', () => {
    const n = extractMicrodataRecipe(
      scope(`<b itemprop="name">${'x'.repeat(5_000_000)}</b>`),
    ).node!;
    expect((n['name'] as string).length).toBeLessThanOrEqual(8_000);
  });
  it('enormous attribute is truncated', () => {
    const n = extractMicrodataRecipe(
      scope(`<meta itemprop="name" content="${'y'.repeat(2_000_000)}">`),
    ).node!;
    expect((n['name'] as string).length).toBeLessThanOrEqual(4_000);
  });
  it('many ingredients are capped', () => {
    const n = extractMicrodataRecipe(
      scope('<i itemprop="recipeIngredient">a</i>'.repeat(50_000)),
    ).node!;
    expect((n['recipeIngredient'] as unknown[]).length).toBeLessThanOrEqual(500);
  });
  it('node budget: a recipe beyond the cap is not found, no hang', () => {
    const filler = '<p>x</p>'.repeat(100_000);
    const t = Date.now();
    const r = extractMicrodataRecipe(
      wrap(filler + '<div itemscope itemtype="https://schema.org/Recipe"></div>'),
    );
    expect(r.node).toBeNull();
    expect(Date.now() - t).toBeLessThan(5_000);
  });
  it('5 MB adversarial documents finish', () => {
    const t = Date.now();
    extractMicrodataRecipe('<div itemscope>'.repeat(350_000));
    extractMicrodataRecipe(
      wrap(
        '<div itemscope itemtype="https://schema.org/Recipe">' +
          '<span itemprop="a b c">z</span>'.repeat(150_000),
      ),
    );
    extractMicrodataRecipe('<div>'.repeat(1_000_000) + 'itemscope');
    expect(Date.now() - t).toBeLessThan(20_000);
  });
  it('itemprop in unterminated comment / cyclic-looking markup does not throw', () => {
    expect(() => extractMicrodataRecipe(scope('<!-- <b itemprop="name">x</b>'))).not.toThrow();
    expect(() =>
      extractMicrodataRecipe(scope('<b itemprop="name" itemref="a" id="a" itemscope>x</b>')),
    ).not.toThrow();
  });
  it('page without itemscope skips the parse', () => {
    expect(
      extractMicrodataRecipe(
        '<div itemtype="https://schema.org/Recipe"><b itemprop="name">x</b></div>',
      ).node,
    ).toBeNull();
  });
});
