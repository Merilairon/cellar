import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import { user } from './schema';
import { buildMatchQuery, searchRecipes } from './search';
import {
  createRecipeFor,
  setVisibilityFor,
  updateRecipeFor,
  type Actor,
} from '@/lib/recipes/service';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import type { RecipeInput } from '@/lib/recipes/schemas';

let db: Db;
let a: Actor;
let b: Actor;
let admin: Actor;
const mk = (email: string, role: 'member' | 'admin' = 'member') =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role })
    .returning()
    .get() as Actor;
beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  a = mk('a@x.test');
  b = mk('b@x.test');
  admin = mk('adm@x.test', 'admin');
});
afterEach(() => db.$client.close());

const ingr = (name: string) =>
  ({ name, display_primary: 'metric' }) as RecipeInput['sections'][number]['ingredients'][number];
function add(actor: Actor, over: Partial<RecipeInput> & { names?: string[] }): string {
  const { names, ...rest } = over;
  const body = {
    ...SAMPLE_SKILLET_COOKIES,
    visibility: 'private',
    tags: [],
    ...rest,
    sections: names
      ? [{ title: null, ingredients: names.map(ingr), steps: [] }]
      : SAMPLE_SKILLET_COOKIES.sections,
  };
  const r = createRecipeFor(db, actor, body);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.recipe.id;
}
const ids = (actor: Actor, o: Parameters<typeof searchRecipes>[2]) =>
  searchRecipes(db, actor.id, o).map((r) => r.id);

describe('buildMatchQuery', () => {
  it('quotes every token and appends the prefix operator', () => {
    expect(buildMatchQuery('choc brow')).toBe('"choc"* "brow"*');
    expect(buildMatchQuery('Café')).toBe('"Café"*');
  });
  it('drops operators and punctuation, and short tokens', () => {
    expect(buildMatchQuery('a')).toBeNull();
    expect(buildMatchQuery('   ')).toBeNull();
    expect(buildMatchQuery('"*^-():')).toBeNull();
    expect(buildMatchQuery('espresso AND NOT cookies')).toBe(
      '"espresso"* "AND"* "NOT"* "cookies"*',
    );
    expect(buildMatchQuery('title:secret')).toBe('"title"* "secret"*');
  });
  it('bounds length and token count', () => {
    expect(buildMatchQuery('x'.repeat(10_000))!.length).toBeLessThan(110);
    const q = buildMatchQuery('aa bb cc dd ee ff gg hh ii jj')!;
    expect(q.split(' ')).toHaveLength(8);
  });
});

describe('searchRecipes', () => {
  it('finds the sample by ingredient name (espresso), by prefix, case and diacritics', () => {
    const id = add(a, { visibility: 'users' });
    expect(ids(b, { q: 'espresso' })).toEqual([id]);
    expect(ids(b, { q: 'ESPR' })).toEqual([id]);
    expect(ids(b, { q: 'choc brow' })).toEqual([id]);
    expect(ids(b, { q: 'choc zzz' })).toEqual([]);
    expect(ids(b, { q: 'ésprésso' })).toEqual([id]);
    expect(ids(b, { q: 'a' })).toEqual([]);
    expect(ids(b, { q: 'nonexistentword' })).toEqual([]);
  });

  it("never finds another user's private recipe (q, tag, author variants); owner and flips", () => {
    const id = add(a, { tags: ['secretly'] });
    expect(ids(a, { q: 'espresso' })).toEqual([id]);
    expect(ids(b, { q: 'espresso' })).toEqual([]);
    expect(ids(b, { q: 'espresso', tag: 'secretly' })).toEqual([]);
    expect(ids(b, { q: 'espresso', author: a.id })).toEqual([]);
    expect(ids(b, { tag: 'secretly' })).toEqual([]);
    expect(ids(b, { q: 'secretly' })).toEqual([]);
    // admins get no extra reach
    expect(ids(admin, { q: 'espresso' })).toEqual([]);
    expect(setVisibilityFor(db, a, id, { visibility: 'users' }).ok).toBe(true);
    expect(ids(b, { q: 'espresso' })).toEqual([id]);
    expect(setVisibilityFor(db, a, id, { visibility: 'private' }).ok).toBe(true);
    expect(ids(b, { q: 'espresso' })).toEqual([]);
  });

  it('tag and author filters AND with q; author=me; unknown author is empty', () => {
    const x = add(a, { visibility: 'users', tags: ['Dessert'], names: ['espresso'], title: 'X' });
    const y = add(b, { visibility: 'users', tags: ['dinner'], names: ['espresso'], title: 'Y' });
    expect(ids(a, { tag: 'dessert' }).sort()).toEqual([x]);
    expect(ids(a, { tag: ' DESSERT ' })).toEqual([x]);
    expect(ids(a, { q: 'espresso' }).sort()).toEqual([x, y].sort());
    expect(ids(a, { q: 'espresso', tag: 'dinner' })).toEqual([y]);
    expect(ids(a, { q: 'espresso', tag: 'dinner', author: a.id })).toEqual([]);
    expect(ids(a, { q: 'espresso', author: 'me' })).toEqual([x]);
    expect(ids(a, { author: b.id })).toEqual([y]);
    expect(ids(a, { author: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })).toEqual([]);
    expect(ids(a, { tag: 'nope' })).toEqual([]);
    expect(ids(a, { tag: '   ' })).toEqual([]);
  });

  it('ranks a title hit above an ingredient-only hit; tags in the items', () => {
    const ing = add(a, {
      visibility: 'users',
      names: ['espresso powder'],
      title: 'Cake',
      tags: ['b', 'a'],
    });
    const title = add(a, {
      visibility: 'users',
      names: ['water'],
      title: 'Espresso',
      description: null,
    });
    const r = searchRecipes(db, a.id, { q: 'espresso' });
    expect(r.map((x) => x.id)).toEqual([title, ing]);
    expect(r[1]!.tags).toEqual(['a', 'b']);
  });

  it('stays in sync after an update', () => {
    const id = add(a, { names: ['espresso'] });
    const upd = updateRecipeFor(db, a, id, {
      ...SAMPLE_SKILLET_COOKIES,
      visibility: 'private',
      tags: [],
      sections: [{ title: null, ingredients: [ingr('matcha')], steps: [] }],
    });
    expect(upd.ok).toBe(true);
    expect(ids(a, { q: 'espresso' })).toEqual([]);
    expect(ids(a, { q: 'matcha' })).toEqual([id]);
  });

  it('no q: newest first, unchanged list, no row cap', () => {
    const one = add(a, { visibility: 'users', title: 'one' });
    const two = add(a, { visibility: 'users', title: 'two' });
    expect(ids(b, {})).toEqual([two, one]);
  });

  it('hostile queries never throw and never leak', () => {
    add(a, { names: ['espresso'], tags: ['secret'], title: 'secret title' });
    add(b, { visibility: 'users', names: ['espresso'], title: 'cookies' });
    const hostile = [
      '" OR 1=1',
      "'; DROP TABLE recipe; --",
      'espresso AND NOT cookies',
      'NEAR(a b)',
      'NEAR(a b, 5)',
      'title:secret',
      'tags : secret',
      '{title}: secret',
      '*',
      '^',
      '-secret',
      '"',
      '""',
      '"unbalanced',
      'unbalanced"',
      '(',
      ')',
      '((a)',
      'a OR',
      'OR',
      'NOT',
      'AND AND',
      'x'.repeat(10_000),
      'word '.repeat(5_000),
      '\u0000',
      'a\u0000b',
      '😀😀',
      '🍪 cookie',
      'שלום עולם',
      'مرحبا',
      '%',
      '_',
      '100%',
      '\\',
      'ａｂｃ',
      'éspresso',
      '\uD800',
      '\n\t',
      '::',
      'recipe_fts',
      'match',
    ];
    for (const q of hostile) {
      expect(() => searchRecipes(db, b.id, { q }), JSON.stringify(q)).not.toThrow();
      for (const r of searchRecipes(db, b.id, { q }))
        expect(r.ownerId === a.id ? r.visibility : 'users').toBe('users');
    }
    // operators are inert text: "title:secret" searches for the words title and secret (AND)
    expect(ids(b, { q: 'title:secret' })).toEqual([]);
    expect(ids(a, { q: 'title:secret' })).toHaveLength(1);
    expect(ids(b, { q: 'espresso AND NOT cookies' })).toEqual([]);
    expect(ids(b, { q: '-secret' })).toEqual([]);
  });

  it('prints search and PUT-with-triggers timings (no assertion on speed)', () => {
    const t0 = performance.now();
    db.transaction(() => {
      for (let i = 0; i < 300; i++) {
        add(a, {
          visibility: 'users',
          title: `Recipe ${i}`,
          tags: [`t${i % 7}`, 'common'],
          names: Array.from({ length: 15 }, (_, k) => `ingredient${k} item${i}`),
        });
      }
    });
    const t1 = performance.now();
    const target = ids(a, { q: 'item150' })[0]!;
    const body = {
      ...SAMPLE_SKILLET_COOKIES,
      visibility: 'users',
      tags: ['x'],
      sections: [
        {
          title: null,
          ingredients: Array.from({ length: 40 }, (_, k) => ingr(`ing${k}`)),
          steps: [],
        },
      ],
    };
    const t2 = performance.now();
    for (let i = 0; i < 5; i++) expect(updateRecipeFor(db, a, target, body).ok).toBe(true);
    const t3 = performance.now();
    for (let i = 0; i < 20; i++) searchRecipes(db, b.id, { q: 'ingredient3 item1' });
    const t4 = performance.now();
    console.log(
      `[T6 perf] create 300x15 ing: ${((t1 - t0) / 300).toFixed(1)} ms/recipe; PUT 40 ing with triggers: ${((t3 - t2) / 5).toFixed(1)} ms; search @300 recipes: ${((t4 - t3) / 20).toFixed(2)} ms`,
    );
  }, 120_000);
});
