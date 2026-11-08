import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb, type Db } from './connection';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate';
import { createRecipe, replaceGrid, replaceRecipe, type RecipeTree } from './recipes';

let db: Db;
afterEach(() => db.$client.close());
const c = () => db.$client;
const all = <T>(sql: string, ...p: unknown[]) =>
  c()
    .prepare(sql)
    .all(...p) as T[];
const one = <T>(sql: string, ...p: unknown[]) =>
  c()
    .prepare(sql)
    .get(...p) as T;
const run = (sql: string, ...p: unknown[]) =>
  c()
    .prepare(sql)
    .run(...p);

let seq = 0;
const nid = (p: string) => `${p}${String(++seq).padStart(6, '0')}`;
const NOW = '2026-01-01T00:00:00.000Z';
const count = (table: string) => one<{ n: number }>(`SELECT count(*) n FROM ${table}`).n;

function addUser(): string {
  const id = nid('U');
  run(
    `INSERT INTO user (id, email, display_name, password_hash, role, created_at) VALUES (?, ?, 'u', 'h', 'member', ?)`,
    id,
    `${id}@x.test`,
    NOW,
  );
  return id;
}
function addRecipe(owner: string, title = 'Soup'): string {
  const id = nid('R');
  run(
    `INSERT INTO recipe (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    id,
    owner,
    title,
    NOW,
    NOW,
  );
  return id;
}
function addPhoto(recipeId: string, cover = false): string {
  const id = nid('P');
  run(
    `INSERT INTO photo (id, recipe_id, file_path, width, height, position, is_cover, created_at) VALUES (?, ?, ?, 10, 10, 0, ?, ?)`,
    id,
    recipeId,
    `${id}.webp`,
    cover ? 1 : 0,
    NOW,
  );
  return id;
}
function addNote(recipeId: string, userId: string, body: string, shared = 0): string {
  const id = nid('N');
  run(
    `INSERT INTO note (id, recipe_id, user_id, body, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    recipeId,
    userId,
    body,
    shared,
    NOW,
    NOW,
  );
  return id;
}
const addRating = (recipeId: string, userId: string, stars: number) =>
  run(
    `INSERT INTO rating (recipe_id, user_id, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    recipeId,
    userId,
    stars,
    NOW,
    NOW,
  );

const fresh = () => {
  db = openDb(':memory:');
  runMigrations(db);
};

describe('migration 0007 on an empty database', () => {
  it('creates note, rating, photo.thumb_path and note_fts; recipe_fts untouched', () => {
    fresh();
    const names = all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE name IN ('note','rating','note_fts') ORDER BY name`,
    ).map((r) => r.name);
    expect(names).toEqual(['note', 'note_fts', 'rating']);
    const cols = all<{ name: string; notnull: number }>(`PRAGMA table_info(photo)`);
    expect(cols.find((x) => x.name === 'thumb_path')).toMatchObject({ notnull: 0 });
    expect(
      all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='note' ORDER BY name`,
      ).map((r) => r.name),
    ).toEqual(['note_fts_note_ad', 'note_fts_note_ai', 'note_fts_note_au']);
    expect(c().pragma('foreign_key_check')).toEqual([]);
  });
});

describe('migration 0007 on a 0006 database', () => {
  it('keeps recipes, tags, photos and FTS rows unchanged; photos get a NULL thumb_path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig7-'));
    try {
      db = openDb(':memory:');
      cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
      const jp = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(jp, 'utf8'));
      const full = journal.entries;
      expect(full[7].tag).toBe('0007_note_rating_thumb');
      journal.entries = full.slice(0, 7);
      writeFileSync(jp, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      expect(
        all(`SELECT name FROM sqlite_master WHERE name IN ('note','rating','note_fts')`),
      ).toEqual([]);

      const u = addUser();
      const r1 = addRecipe(u, 'Crème brûlée');
      const r2 = addRecipe(u, 'Toast');
      addPhoto(r1, true);
      addPhoto(r1);
      addPhoto(r2);
      const tid = nid('T');
      run(`INSERT INTO tag (id, name, created_at) VALUES (?, 'dessert', ?)`, tid, NOW);
      run(`INSERT INTO recipe_tag (recipe_id, tag_id) VALUES (?, ?)`, r1, tid);
      const snap = () => ({
        recipes: all(`SELECT * FROM recipe ORDER BY id`),
        tags: all(`SELECT * FROM tag ORDER BY id`),
        recipeTags: all(`SELECT * FROM recipe_tag ORDER BY recipe_id, tag_id`),
        photos: all(
          `SELECT id, recipe_id, file_path, width, height, position, is_cover, created_at FROM photo ORDER BY id`,
        ),
        fts: all(`SELECT * FROM recipe_fts ORDER BY recipe_id`),
      });
      const before = snap();
      expect(before.fts).toHaveLength(2);

      journal.entries = full;
      writeFileSync(jp, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });

      expect(snap()).toEqual(before);
      expect(count('recipe_fts')).toBe(count('recipe'));
      expect(all<{ thumb_path: string | null }>(`SELECT thumb_path FROM photo`)).toEqual([
        { thumb_path: null },
        { thumb_path: null },
        { thumb_path: null },
      ]);
      expect(count('note')).toBe(0);
      expect(count('note_fts')).toBe(0);
      expect(c().pragma('foreign_key_check')).toEqual([]);
      expect(c().pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(() => migrate(db, { migrationsFolder: dir })).not.toThrow();
      expect(count('note')).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('note and rating constraints', () => {
  it('rejects stars outside 1..5 and a duplicate (recipe, user) rating', () => {
    fresh();
    const u = addUser();
    const r = addRecipe(u);
    expect(() => addRating(r, u, 0)).toThrow(/CHECK/);
    expect(() => addRating(r, u, 6)).toThrow(/CHECK/);
    for (const s of [1, 5]) {
      run(`DELETE FROM rating`);
      addRating(r, u, s);
    }
    expect(() => addRating(r, u, 3)).toThrow(/UNIQUE|PRIMARY/);
    const u2 = addUser();
    expect(() => addRating(r, u2, 3)).not.toThrow();
  });

  it('rejects an empty or 4001-character note, accepts 1 and 4000', () => {
    fresh();
    const u = addUser();
    const r = addRecipe(u);
    expect(() => addNote(r, u, '')).toThrow(/CHECK/);
    expect(() => addNote(r, u, 'x'.repeat(4001))).toThrow(/CHECK/);
    expect(() => addNote(r, u, 'x')).not.toThrow();
    expect(() => addNote(r, u, 'x'.repeat(4000))).not.toThrow();
    expect(() => run(`UPDATE note SET body = '' WHERE recipe_id = ?`, r)).toThrow(/CHECK/);
    expect(count('note_fts')).toBe(2); // rejected writes left no index rows
  });

  it('allows shared only as 0 or 1', () => {
    fresh();
    const u = addUser();
    const r = addRecipe(u);
    expect(() => addNote(r, u, 'a', 2)).toThrow(/CHECK/);
    expect(() => addNote(r, u, 'a', -1)).toThrow(/CHECK/);
    addNote(r, u, 'a', 0);
    addNote(r, u, 'b', 1);
    expect(one<{ shared: number }>(`SELECT shared FROM note WHERE body='b'`).shared).toBe(1);
  });

  it('rejects rows pointing at a missing recipe or user', () => {
    fresh();
    const u = addUser();
    const r = addRecipe(u);
    expect(() => addNote('nope', u, 'a')).toThrow(/FOREIGN KEY/);
    expect(() => addNote(r, 'nope', 'a')).toThrow(/FOREIGN KEY/);
    expect(() => addRating('nope', u, 3)).toThrow(/FOREIGN KEY/);
    expect(() => addRating(r, 'nope', 3)).toThrow(/FOREIGN KEY/);
  });

  it('cascades on recipe delete (notes, ratings, index rows) and on user delete (Q14)', () => {
    fresh();
    const owner = addUser();
    const other = addUser();
    const r1 = addRecipe(owner);
    const r2 = addRecipe(owner);
    addNote(r1, owner, 'soup note', 1);
    addNote(r1, other, 'other note', 1);
    addNote(r2, other, 'private other', 0);
    addRating(r1, owner, 4);
    addRating(r1, other, 2);
    addRating(r2, other, 5);

    run(`DELETE FROM recipe WHERE id = ?`, r2);
    expect(all(`SELECT 1 FROM note WHERE recipe_id = ?`, r2)).toEqual([]);
    expect(all(`SELECT 1 FROM rating WHERE recipe_id = ?`, r2)).toEqual([]);
    expect(all(`SELECT 1 FROM note_fts WHERE recipe_id = ?`, r2)).toEqual([]);
    expect(count('note')).toBe(2);

    run(`DELETE FROM user WHERE id = ?`, other);
    expect(all<{ user_id: string }>(`SELECT user_id FROM note`)).toEqual([{ user_id: owner }]);
    expect(all<{ user_id: string }>(`SELECT user_id FROM rating`)).toEqual([{ user_id: owner }]);
    expect(count('note_fts')).toBe(1);
    expect(count('recipe')).toBe(1); // recipes of other users untouched
  });
});

describe('note_fts', () => {
  const rebuild = () =>
    all<{ note_id: string; recipe_id: string; body: string }>(
      `SELECT id AS note_id, recipe_id, body FROM note ORDER BY id`,
    );
  const index = () =>
    all<{ note_id: string; recipe_id: string; body: string }>(
      `SELECT note_id, recipe_id, body FROM note_fts ORDER BY note_id`,
    );
  const noteHits = (q: string) =>
    all<{ note_id: string }>(`SELECT note_id FROM note_fts WHERE note_fts MATCH ?`, q)
      .map((r) => r.note_id)
      .sort();

  it('indexes insert, update of body and delete; recipe_fts.notes stays empty', () => {
    fresh();
    const u = addUser();
    const r = addRecipe(u);
    const n = addNote(r, u, 'Crème fraîche works', 0);
    expect(noteHits('creme')).toEqual([n]);
    expect(noteHits('fra*')).toEqual([n]);
    run(`UPDATE note SET body = 'use yoghurt' WHERE id = ?`, n);
    expect(noteHits('creme')).toEqual([]);
    expect(noteHits('yoghurt')).toEqual([n]);
    run(`UPDATE note SET shared = 1 WHERE id = ?`, n); // not a body change: no reindex needed
    expect(index()).toEqual(rebuild());
    run(`DELETE FROM note WHERE id = ?`, n);
    expect(index()).toEqual([]);
    expect(one<{ n: number }>(`SELECT count(*) n FROM recipe_fts WHERE notes <> ''`).n).toBe(0);
  });

  it('equals a fresh rebuild after random insert/update/delete sequences', () => {
    fresh();
    const users = [addUser(), addUser()];
    const recipes = [addRecipe(users[0]!), addRecipe(users[0]!), addRecipe(users[1]!)];
    // Deterministic LCG so a failure is reproducible.
    let state = 12345;
    const rnd = (n: number) => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state % n;
    };
    const words = ['basil', 'crème', 'garlic', 'oven', 'salt', 'très', 'cold', 'zest'];
    const body = () => Array.from({ length: 1 + rnd(5) }, () => words[rnd(words.length)]).join(' ');
    for (let i = 0; i < 300; i++) {
      const ids = all<{ id: string }>(`SELECT id FROM note`).map((x) => x.id);
      const op = rnd(10);
      if (op < 4 || ids.length === 0) {
        addNote(recipes[rnd(3)]!, users[rnd(2)]!, body(), rnd(2));
      } else if (op < 7) {
        run(`UPDATE note SET body = ? WHERE id = ?`, body(), ids[rnd(ids.length)]);
      } else if (op < 8) {
        run(`UPDATE note SET shared = ? WHERE id = ?`, rnd(2), ids[rnd(ids.length)]);
      } else if (op < 9) {
        run(`DELETE FROM note WHERE id = ?`, ids[rnd(ids.length)]);
      } else if (rnd(4) === 0) {
        run(`DELETE FROM recipe WHERE id = ?`, recipes[rnd(3)]);
      }
      if (i % 25 === 0) expect(index()).toEqual(rebuild());
    }
    expect(index()).toEqual(rebuild());
    expect(count('note')).toBeGreaterThan(0);
    // The MATCH side agrees too, not only the stored columns.
    for (const w of words) {
      const expected = rebuild()
        .filter((r) =>
          r.body
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .split(' ')
            .includes(w.normalize('NFD').replace(/\p{M}/gu, '')),
        )
        .map((r) => r.note_id);
      expect(noteHits(`"${w}"`)).toEqual(expected);
    }
  });
});

describe('ids change on every save (G6): note, rating and photo rows are untouched', () => {
  const tree = (title: string): RecipeTree => ({
    fields: {
      title,
      description: null,
      servings: null,
      servingsLabel: null,
      prepMinutes: null,
      cookMinutes: null,
      sourceUrl: null,
      sourceName: null,
      visibility: 'private',
      viewMode: 'grid',
    },
    sections: [
      {
        title: 'A',
        ingredients: [
          {
            name: 'flour',
            note: null,
            rawText: 'flour',
            metricQty: null,
            metricUnit: null,
            usQty: null,
            usUnit: null,
            displayPrimary: 'metric',
            splitGroupId: null,
            portionLabel: null,
            groupLabel: null,
          },
        ],
        steps: [
          {
            kind: 'column',
            label: 'mix',
            detail: 'mix it',
            rowStart: 0,
            rowEnd: 0,
            tempC: null,
            tempF: null,
            minutesMin: null,
            minutesMax: null,
          },
        ],
      },
    ],
  });
  const snap = () => ({
    notes: all(`SELECT * FROM note ORDER BY id`),
    ratings: all(`SELECT * FROM rating ORDER BY recipe_id, user_id`),
    photos: all(`SELECT * FROM photo ORDER BY id`),
    noteFts: all(`SELECT * FROM note_fts ORDER BY note_id`),
  });

  it('recipe PUT and grid save leave them byte-identical; note/rating writes keep updated_at', () => {
    fresh();
    const u = addUser();
    const v = addUser();
    const id = createRecipe(db, u, tree('Original'));
    const photo = addPhoto(id, true);
    run(`UPDATE photo SET thumb_path = 'thumb.webp' WHERE id = ?`, photo);
    addNote(id, u, 'my private note', 0);
    addNote(id, v, 'shared with all', 1);
    addRating(id, u, 4);
    addRating(id, v, 2);
    const stamp = () =>
      one<{ updated_at: string }>(`SELECT updated_at FROM recipe WHERE id = ?`, id).updated_at;

    // Note and rating writes never touch recipe.updated_at.
    const t0 = stamp();
    addNote(id, v, 'another', 0);
    run(`UPDATE note SET body = 'edited', updated_at = ? WHERE body = 'another'`, '2027-01-01');
    run(`UPDATE rating SET stars = 5 WHERE recipe_id = ? AND user_id = ?`, id, v);
    run(`DELETE FROM note WHERE body = 'edited'`);
    run(`DELETE FROM rating WHERE user_id = ?`, v);
    addRating(id, v, 2);
    expect(stamp()).toBe(t0);

    const before = snap();
    const sectionIdsBefore = all(`SELECT id FROM section WHERE recipe_id = ?`, id);

    expect(replaceRecipe(db, id, tree('Renamed'))).toBe(true);
    expect(snap()).toEqual(before);

    const base = stamp();
    expect(base).not.toBe(t0);
    expect(
      replaceGrid(db, id, tree('ignored').sections, { baseUpdatedAt: base, viewMode: 'grid' }),
    ).toBe(true);
    expect(snap()).toEqual(before);
    expect(all(`SELECT id FROM section WHERE recipe_id = ?`, id)).not.toEqual(sectionIdsBefore); // ids did change
    expect(count('note')).toBe(2);
  });
});
