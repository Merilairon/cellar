import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import { user } from './schema';
import { searchRecipes } from './search';
import { createRecipeFor, type Actor } from '@/lib/recipes/service';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import type { RecipeInput } from '@/lib/recipes/schemas';

// T7 (v0.4.2): notes in search with per-user visibility. Tests tagged [PRIVATE-NOTE] are the
// ones the recorded negative control (removing `shared = 1 or user_id = me`) must break.

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
  admin = mk('admin@x.test', 'admin');
});
afterEach(() => db.$client.close());

const make = (actor: Actor, title: string, over: Partial<RecipeInput> = {}) => {
  const r = createRecipeFor(db, actor, {
    ...SAMPLE_SKILLET_COOKIES,
    title,
    visibility: 'users',
    tags: [],
    ...over,
  } as RecipeInput);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.recipe.id;
};
let seq = 0;
const addNote = (recipeId: string, userId: string, bodyText: string, shared: boolean) => {
  const id = `N${String(++seq).padStart(6, '0')}`;
  const now = new Date().toISOString();
  db.$client
    .prepare(
      'insert into note (id, recipe_id, user_id, body, shared, created_at, updated_at) values (?,?,?,?,?,?,?)',
    )
    .run(id, recipeId, userId, bodyText, shared ? 1 : 0, now, now);
  return id;
};
const ids = (actor: Actor, q: string, o: Record<string, unknown> = {}) =>
  searchRecipes(db, actor.id, { q, ...o }).map((r) => r.id);

describe('note branch of search (T7)', () => {
  it('[PRIVATE-NOTE] finds a word only in the caller own private note', () => {
    const r = make(a, 'Plain Soup');
    addNote(r, b.id, 'zanzibar trick', false);
    expect(ids(b, 'zanzibar')).toEqual([r]);
  });

  it("finds a word only in another user's shared note", () => {
    const r = make(a, 'Plain Soup');
    addNote(r, a.id, 'zanzibar trick', true);
    expect(ids(b, 'zanzibar')).toEqual([r]);
  });

  it("[PRIVATE-NOTE] does NOT find a word only in another user's private note (member and admin)", () => {
    const r = make(a, 'Plain Soup');
    addNote(r, a.id, 'zanzibar secret', false);
    expect(ids(b, 'zanzibar')).toEqual([]);
    expect(ids(admin, 'zanzibar')).toEqual([]);
    expect(ids(a, 'zanzibar')).toEqual([r]);
  });

  it('[PRIVATE-NOTE] admin gets no reach into a private recipe via a shared note either', () => {
    const r = make(a, 'Hidden', { visibility: 'private' });
    addNote(r, a.id, 'zanzibar', true);
    expect(ids(admin, 'zanzibar')).toEqual([]);
    expect(ids(b, 'zanzibar')).toEqual([]);
  });

  it("[PRIVATE-NOTE] B's results are identical with and without A's private note", () => {
    const r1 = make(a, 'Lemon Cake');
    const r2 = make(a, 'Lemon Tart');
    make(a, 'Lemon Pie');
    addNote(r2, b.id, 'lemon zest', true);
    const snap = () =>
      JSON.stringify(
        ['lemon', 'qqqzzz', 'lemon qqqzzz'].map((q) => searchRecipes(db, b.id, { q })),
      );
    const without = snap();
    const noteId = addNote(r1, a.id, 'lemon lemon lemon lemon qqqzzz', false);
    expect(snap()).toBe(without);
    db.$client.prepare('delete from note where id = ?').run(noteId);
    expect(snap()).toBe(without);
    // and for a word that only A's private note contains
    expect(ids(b, 'qqqzzz')).toEqual([]);
  });

  it('note-only matches rank after recipe_fts matches', () => {
    const noteOnly = make(a, 'Plain Soup');
    const titled = make(a, 'Zanzibar Stew');
    addNote(noteOnly, a.id, 'zanzibar', true);
    expect(ids(b, 'zanzibar')).toEqual([titled, noteOnly]);
  });

  it('operators are inert on the note branch', () => {
    const r = make(a, 'Plain Soup');
    addNote(r, a.id, 'alpha beta', true);
    for (const q of [
      'alpha OR zzzz',
      'NEAR(alpha beta)',
      'body:alpha',
      '"alpha',
      'alp*',
      'alpha NOT beta',
      '-alpha',
    ])
      expect(() => searchRecipes(db, b.id, { q }), q).not.toThrow();
    expect(ids(b, 'alpha OR zzzz')).toEqual([]); // AND semantics: zzzz must match too
    expect(ids(b, 'body:alpha')).toEqual([]); // 'body' is plain text, not a column filter
    expect(ids(b, 'alpha NEAR beta')).toEqual([]); // NEAR is a plain token
  });

  it('empty and token-limit behaviour is unchanged', () => {
    const r = make(a, 'Plain Soup');
    addNote(r, a.id, 'one two three four five six seven eight', true);
    expect(ids(b, '   ')).toEqual([r]); // blank q = no search: the readable list
    expect(ids(b, 'a !')).toEqual([]);
    // 9th token is dropped, so it does not have to match.
    expect(ids(b, 'one two three four five six seven eight nonsense')).toEqual([r]);
    expect(ids(b, 'one two three four five six seven nonsense eight')).toEqual([]);
  });

  it('[PRIVATE-NOTE] unsharing, editing and deleting update results immediately', () => {
    const r = make(a, 'Plain Soup');
    const n = addNote(r, a.id, 'zanzibar', true);
    expect(ids(b, 'zanzibar')).toEqual([r]);
    db.$client.prepare('update note set shared = 0 where id = ?').run(n);
    expect(ids(b, 'zanzibar')).toEqual([]);
    expect(ids(a, 'zanzibar')).toEqual([r]);
    db.$client.prepare('update note set shared = 1 where id = ?').run(n);
    expect(ids(b, 'zanzibar')).toEqual([r]);
    db.$client.prepare("update note set body = 'oldbody' where id = ?").run(n);
    expect(ids(b, 'zanzibar')).toEqual([]);
    expect(ids(b, 'oldbody')).toEqual([r]);
    db.$client.prepare('delete from note where id = ?').run(n);
    expect(ids(b, 'oldbody')).toEqual([]);
  });

  it('combines with min_rating, tag and author', () => {
    const r1 = make(a, 'Plain Soup', { tags: ['dinner'] });
    const r2 = make(b, 'Other Soup');
    addNote(r1, a.id, 'zanzibar', true);
    addNote(r2, b.id, 'zanzibar', true);
    const now = new Date().toISOString();
    db.$client
      .prepare(
        'insert into rating (recipe_id, user_id, stars, created_at, updated_at) values (?,?,?,?,?)',
      )
      .run(r1, b.id, 5, now, now);
    expect(ids(b, 'zanzibar').sort()).toEqual([r1, r2].sort());
    expect(ids(b, 'zanzibar', { minRating: 4 })).toEqual([r1]);
    expect(ids(b, 'zanzibar', { tag: 'dinner' })).toEqual([r1]);
    expect(ids(b, 'zanzibar', { author: 'me' })).toEqual([r2]);
    expect(ids(b, 'zanzibar', { author: a.id })).toEqual([r1]);
  });

  it('a recipe matching in both branches appears once', () => {
    const r = make(a, 'Zanzibar Stew');
    addNote(r, a.id, 'zanzibar', true);
    expect(ids(b, 'zanzibar')).toEqual([r]);
  });
});

describe('C4 timing (printed, nothing asserted)', () => {
  it('private-note match vs no match', () => {
    for (let i = 0; i < 100; i++) {
      const r = make(a, `Recipe ${i}`);
      addNote(r, a.id, `filler words ${i}`, false);
    }
    addNote(make(a, 'Target'), a.id, 'zanzibar secret', false);
    const time = (q: string) => {
      const xs: number[] = [];
      for (let i = 0; i < 200; i++) {
        const t = performance.now();
        searchRecipes(db, b.id, { q });
        xs.push(performance.now() - t);
      }
      xs.sort((x, y) => x - y);
      return `median ${xs[100]!.toFixed(3)} ms, p95 ${xs[190]!.toFixed(3)} ms`;
    };
    console.log(
      `C4 other's private-note match: ${time('zanzibar')}\nC4 no match at all:           ${time('qqqzzz')}`,
    );
  }, 60_000);
});
