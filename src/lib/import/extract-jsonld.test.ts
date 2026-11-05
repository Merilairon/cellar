import { describe, expect, it } from 'vitest';
import { extractRecipeNode, repairJson } from './extract-jsonld';

const ld = (json: string, attrs = 'type="application/ld+json"') =>
  `<script ${attrs}>${json}</script>`;
const page = (...scripts: string[]) =>
  `<!doctype html><html><head>${scripts.join('')}</head><body></body></html>`;
const R = (extra = '') => `{"@type":"Recipe","name":"Soup","recipeIngredient":["a","b"]${extra}}`;

const cases: Array<[string, string, string | null]> = [
  ['plain object', page(ld(R())), 'Soup'],
  [
    '@graph',
    page(ld(`{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},${R()}]}`)),
    'Soup',
  ],
  ['root array', page(ld(`[{"@type":"Organization"},${R()}]`)), 'Soup'],
  [
    '@type array',
    page(ld(`{"@type":["Recipe","NewsArticle"],"name":"Soup","recipeIngredient":["a"]}`)),
    'Soup',
  ],
  ['@type namespaced', page(ld(`{"@type":"schema:Recipe","name":"Soup"}`)), 'Soup'],
  ['@type full IRI', page(ld(`{"@type":"http://schema.org/Recipe","name":"Soup"}`)), 'Soup'],
  ['nested mainEntity', page(ld(`{"@type":"WebPage","mainEntity":${R()}}`)), 'Soup'],
  ['nested mainEntityOfPage', page(ld(`{"@type":"Article","mainEntityOfPage":${R()}}`)), 'Soup'],
  ['type attr uppercase', page(ld(R(), 'type="APPLICATION/LD+JSON"')), 'Soup'],
  ['type attr with charset', page(ld(R(), "type='application/ld+json; charset=utf-8'")), 'Soup'],
  ['html comment wrapper', page(ld(`<!-- ${R()} -->`)), 'Soup'],
  ['cdata wrapper', page(ld(`//<![CDATA[\n${R()}\n//]]>`)), 'Soup'],
  [
    'trailing comma',
    page(ld(`{"@type":"Recipe","name":"Soup","recipeIngredient":["a","b",],}`)),
    'Soup',
  ],
  [
    'raw newline in string',
    page(ld(`{"@type":"Recipe","name":"So\nup","recipeIngredient":["a"]}`)),
    'So\nup',
  ],
  ['BOM prefix', page(ld(`﻿${R()}`)), 'Soup'],
  ['invalid script then valid one', page(ld('{not json'), ld(R())), 'Soup'],
  ['non-ld script ignored', page(`<script type="application/json">${R()}</script>`), null],
  ['no scripts', '<html><body>hi</body></html>', null],
  ['other types only', page(ld(`{"@type":"Article","name":"x"}`)), null],
  ['empty script', page(ld('')), null],
  [
    'malformed html still works',
    `<div><script type="application/ld+json">${R()}</script><p>`,
    'Soup',
  ],
  ['empty string input', '', null],
];

describe('extractRecipeNode', () => {
  it.each(cases)('%s', (_n, html, name) => {
    const r = extractRecipeNode(html);
    expect((r.node?.['name'] as string | undefined) ?? null).toBe(name);
    expect(r.found).toBe(name === null ? 0 : 1);
  });

  it('picks the Recipe with the most ingredients, first on ties', () => {
    const a = `{"@type":"Recipe","name":"A","recipeIngredient":["1","2"]}`;
    const b = `{"@type":"Recipe","name":"B","recipeIngredient":["1","2","3"]}`;
    const c = `{"@type":"Recipe","name":"C","recipeIngredient":["1","2","3"]}`;
    const r = extractRecipeNode(page(ld(a), ld(`[${b},${c}]`)));
    expect(r.node?.['name']).toBe('B');
    expect(r.found).toBe(3);
    expect(r.notes).toContain('multiple_recipes');
    expect(extractRecipeNode(page(ld(`[${a},${a.replace('"A"', '"A2"')}]`))).node?.['name']).toBe(
      'A',
    );
  });

  it('records notes for repaired and skipped scripts', () => {
    expect(extractRecipeNode(page(ld(`{"@type":"Recipe","name":"x",}`))).notes).toContain(
      'jsonld_repaired',
    );
    expect(extractRecipeNode(page(ld('{bad'))).notes).toContain('invalid_jsonld_skipped');
    expect(extractRecipeNode('<p>x</p>').notes).toContain('no_jsonld');
  });

  it('does not follow @id references or arbitrary properties', () => {
    const r = extractRecipeNode(page(ld(`{"@type":"Article","author":${R()},"@id":"#x"}`)));
    expect(r.node).toBeNull();
  });

  it('survives pathological input in bounded time', () => {
    const deep = '['.repeat(200_000) + ']'.repeat(200_000);
    const big = `{"@type":"Recipe","name":"Big","recipeIngredient":[${'"x",'.repeat(1_000_000)}"y"]}`;
    const t0 = Date.now();
    const r1 = extractRecipeNode(page(ld(deep)));
    const r2 = extractRecipeNode(page(ld(big)));
    const r3 = extractRecipeNode('<div>'.repeat(1_000_000)); // 5 MB of nesting
    expect(extractRecipeNode('<script '.repeat(600_000)).node).toBeNull();
    expect(
      extractRecipeNode('<script type="application/ld+json">'.repeat(100_000)).node,
    ).toBeNull();
    const r4 = extractRecipeNode(page(...Array.from({ length: 5000 }, () => ld('{"a":1}'))));
    expect(r1.node).toBeNull();
    expect(r2.node?.['name']).toBe('Big');
    expect(r3.node).toBeNull();
    expect(r4.notes).toContain('too_many_scripts');
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
});

describe('repairJson', () => {
  it('leaves commas and brackets inside strings alone', () => {
    const s = '{"a":"x,}","b":[1,2,],}';
    expect(JSON.parse(repairJson(s))).toEqual({ a: 'x,}', b: [1, 2] });
  });
  it('keeps escaped quotes', () => {
    expect(JSON.parse(repairJson('{"a":"say \\"hi,\\"",}'))).toEqual({ a: 'say "hi,"' });
  });
  it('drops non-whitespace control characters in strings', () => {
    expect(JSON.parse(repairJson('{"a":"x\u0001y"}'))).toEqual({ a: 'xy' });
  });
});
