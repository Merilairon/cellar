import { describe, expect, it } from 'vitest';
import { detectPasteKind, recipeNodeFromPaste, splitPlainText } from './paste';

describe('detectPasteKind', () => {
  it('html, jsonld and text', () => {
    expect(detectPasteKind('  <html><body>x')).toBe('html');
    expect(detectPasteKind('foo <script type="application/ld+json">')).toBe('html');
    expect(detectPasteKind('{"@type":"Recipe"}')).toBe('jsonld');
    expect(detectPasteKind('Pancakes\nIngredients\n1 egg')).toBe('text');
    expect(detectPasteKind('{ not a recipe }')).toBe('text');
  });
});

describe('splitPlainText', () => {
  it('title, ingredient lines and step lines', () => {
    const n = splitPlainText(
      'Pancakes\n\nIngredients:\n- 2 eggs\n1 cup flour\n\nInstructions\n1. Mix.\n2. Fry.',
    );
    expect(n).toMatchObject({
      name: 'Pancakes',
      recipeIngredient: ['- 2 eggs', '1 cup flour'],
      recipeInstructions: ['1. Mix.', '2. Fry.'],
    });
  });
  it.each(['Directions', 'Method:', '## Steps', 'Preparation'])('accepts step heading %s', (h) => {
    expect(splitPlainText(`T\nIngredients\n1 egg\n${h}\nDo it`)).not.toBeNull();
  });
  it('is case-insensitive and handles CRLF', () => {
    expect(splitPlainText('T\r\nINGREDIENTS\r\n1 egg\r\nMETHOD\r\nCook\r\n')).not.toBeNull();
  });
  it('returns null without headings, without title, or with an empty section', () => {
    expect(splitPlainText('Just some text\nwith lines')).toBeNull();
    expect(splitPlainText('Ingredients\n1 egg\nMethod\nCook')).toBeNull();
    expect(splitPlainText('T\nIngredients\n1 egg')).toBeNull();
    expect(splitPlainText('T\nIngredients\nMethod\nCook')).toBeNull();
    expect(splitPlainText('')).toBeNull();
  });
});

describe('recipeNodeFromPaste', () => {
  const ld =
    '{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook"]}';
  it('extracts JSON-LD from pasted HTML and from a bare JSON-LD blob', () => {
    expect(
      recipeNodeFromPaste(`<html><script type="application/ld+json">${ld}</script></html>`).node?.[
        'name'
      ],
    ).toBe('X');
    expect(recipeNodeFromPaste(ld).node?.['name']).toBe('X');
  });
  it('falls back to the heading splitter on the visible text of html without JSON-LD', () => {
    const r = recipeNodeFromPaste(
      '<h1>Soup</h1><h2>Ingredients</h2><ul><li>1 onion</li></ul><h2>Method</h2><p>Boil.</p>',
    );
    expect(r.node).toMatchObject({
      name: 'Soup',
      recipeIngredient: ['1 onion'],
      recipeInstructions: ['Boil.'],
    });
  });
  it('handles plain text and returns null for junk', () => {
    expect(recipeNodeFromPaste('Soup\nIngredients\n1 onion\nMethod\nBoil').node?.['name']).toBe(
      'Soup',
    );
    expect(recipeNodeFromPaste('hello world').node).toBeNull();
    expect(recipeNodeFromPaste('<html><body>nothing</body></html>').node).toBeNull();
  });
});
