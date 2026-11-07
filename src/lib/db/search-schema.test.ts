import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb, type Db } from './connection';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate';

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
function addRecipe(owner: string, title: string, description: string | null = null): string {
  const id = nid('R');
  run(
    `INSERT INTO recipe (id, owner_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    owner,
    title,
    description,
    NOW,
    NOW,
  );
  return id;
}
function addSection(recipeId: string): string {
  const id = nid('S');
  const pos = one<{ n: number }>(`SELECT count(*) n FROM section WHERE recipe_id = ?`, recipeId).n;
  run(`INSERT INTO section (id, recipe_id, position) VALUES (?, ?, ?)`, id, recipeId, pos);
  return id;
}
function addIngredient(recipeId: string, name: string, note: string | null = null): string {
  const sec =
    one<{ id: string } | undefined>(`SELECT id FROM section WHERE recipe_id = ? LIMIT 1`, recipeId)
      ?.id ?? addSection(recipeId);
  const id = nid('I');
  const pos = one<{ n: number }>(`SELECT count(*) n FROM ingredient WHERE section_id = ?`, sec).n;
  run(
    `INSERT INTO ingredient (id, recipe_id, section_id, position, name, note, raw_text) VALUES (?, ?, ?, ?, ?, ?, 'raw 4 oz')`,
    id,
    recipeId,
    sec,
    pos,
    name,
    note,
  );
  return id;
}
function tagId(name: string): string {
  const ex = one<{ id: string } | undefined>(`SELECT id FROM tag WHERE name = ?`, name);
  if (ex) return ex.id;
  const id = nid('T');
  run(`INSERT INTO tag (id, name, created_at) VALUES (?, ?, ?)`, id, name, NOW);
  return id;
}
const addTag = (recipeId: string, name: string) =>
  run(`INSERT OR IGNORE INTO recipe_tag (recipe_id, tag_id) VALUES (?, ?)`, recipeId, tagId(name));

type FtsRow = {
  recipe_id: string;
  title: string;
  description: string;
  ingredients: string;
  tags: string;
  notes: string;
};
const fts = () => all<FtsRow>(`SELECT * FROM recipe_fts ORDER BY recipe_id`);
const hits = (q: string) =>
  all<{ recipe_id: string }>(`SELECT recipe_id FROM recipe_fts WHERE recipe_fts MATCH ?`, q)
    .map((r) => r.recipe_id)
    .sort();

/** Independent expectation built from the source tables (JS, not the trigger SQL). */
function expectedIndex(): FtsRow[] {
  return all<{ id: string; title: string; description: string | null }>(
    `SELECT id, title, description FROM recipe ORDER BY id`,
  ).map((r) => ({
    recipe_id: r.id,
    title: r.title,
    description: r.description ?? '',
    ingredients: all<{ name: string; note: string | null }>(
      `SELECT name, note FROM ingredient WHERE recipe_id = ? ORDER BY id`,
      r.id,
    )
      .map((i) => `${i.name} ${i.note ?? ''}`.trim())
      .join(' '),
    tags: all<{ name: string }>(
      `SELECT t.name FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = ? ORDER BY t.name`,
      r.id,
    )
      .map((t) => t.name)
      .join(' '),
    notes: '',
  }));
}
const expectInSync = () => expect(fts()).toEqual(expectedIndex());

const fresh = () => {
  db = openDb(':memory:');
  runMigrations(db);
  return addUser();
};

describe('migration 0005 on a v0.3.2-shaped database', () => {
  it('backfills existing recipes, keeps all rows, passes integrity checks, re-run is a no-op', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig5-'));
    try {
      db = openDb(':memory:');
      cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
      const jp = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(jp, 'utf8'));
      const full = journal.entries;
      expect(full[5].tag).toBe('0005_search_tags');
      journal.entries = full.slice(0, 5); // v0.3.2 shape
      writeFileSync(jp, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      expect(
        all(`SELECT name FROM sqlite_master WHERE name IN ('tag','recipe_tag','recipe_fts')`),
      ).toEqual([]);

      // Rows in the tables a v0.3.2 DB has.
      const u = addUser();
      const r1 = addRecipe(u, 'Crème brûlée', 'Silky custard');
      addIngredient(r1, 'heavy cream', 'cold');
      addIngredient(r1, 'egg yolks');
      const r2 = addRecipe(u, 'Plain toast');
      addIngredient(r2, 'bread');
      const r3 = addRecipe(u, 'Empty'); // no ingredients, no description
      run(
        `INSERT INTO import_job (id, user_id, url, status, recipe_id, created_at, updated_at) VALUES (?, ?, 'https://x.test', 'saved', ?, ?, ?)`,
        nid('J'),
        u,
        r1,
        NOW,
        NOW,
      );
      const before = {
        recipes: all(`SELECT * FROM recipe ORDER BY id`),
        ingredients: all(`SELECT * FROM ingredient ORDER BY id`),
        jobs: all(`SELECT * FROM import_job`),
      };

      journal.entries = full;
      writeFileSync(jp, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });

      expect({
        recipes: all(`SELECT * FROM recipe ORDER BY id`),
        ingredients: all(`SELECT * FROM ingredient ORDER BY id`),
        jobs: all(`SELECT * FROM import_job`),
      }).toEqual(before);
      expect(fts().map((r) => r.recipe_id)).toEqual([r1, r2, r3]);
      expectInSync();
      expect(hits('creme')).toEqual([r1]);
      expect(hits('cold')).toEqual([r1]); // ingredient note indexed
      expect(hits('bre*')).toEqual([r2]);
      expect(hits('"raw"')).toEqual([]); // raw_text not indexed
      expect(c().pragma('foreign_key_check')).toEqual([]);
      expect(c().pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(() => migrate(db, { migrationsFolder: dir })).not.toThrow();
      expect(fts()).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('recipe_fts triggers', () => {
  it('create -> one row; notes column reserved and empty', () => {
    const u = fresh();
    const r = addRecipe(u, 'Espresso brownies', 'Dark');
    expect(fts()).toEqual([
      {
        recipe_id: r,
        title: 'Espresso brownies',
        description: 'Dark',
        ingredients: '',
        tags: '',
        notes: '',
      },
    ]);
  });

  it('title/description update, ingredient edit, replace-all (PUT path)', () => {
    const u = fresh();
    const r = addRecipe(u, 'Old');
    addIngredient(r, 'flour');
    run(`UPDATE recipe SET title = 'New title', description = 'desc' WHERE id = ?`, r);
    expectInSync();
    expect(hits('title:new')).toEqual([r]);
    run(`UPDATE ingredient SET name = 'rye flour', note = 'sifted' WHERE recipe_id = ?`, r);
    expectInSync();
    expect(hits('sifted')).toEqual([r]);
    // Replace: delete all children, insert new ones.
    run(`DELETE FROM ingredient WHERE recipe_id = ?`, r);
    addIngredient(r, 'sugar');
    addIngredient(r, 'butter', 'melted');
    expectInSync();
    expect(fts()).toHaveLength(1);
    expect(hits('flour')).toEqual([]);
    expect(hits('melted')).toEqual([r]);
  });

  it('add/remove recipe_tag, rename tag, delete tag', () => {
    const u = fresh();
    const a = addRecipe(u, 'A');
    const b = addRecipe(u, 'B');
    addTag(a, 'dessert');
    addTag(b, 'dessert');
    addTag(b, 'quick');
    expectInSync();
    expect(hits('tags:dessert')).toEqual([a, b].sort());
    run(`DELETE FROM recipe_tag WHERE recipe_id = ? AND tag_id = ?`, b, tagId('dessert'));
    expect(hits('tags:dessert')).toEqual([a]);
    run(`UPDATE tag SET name = 'sweet' WHERE name = 'dessert'`);
    expectInSync();
    expect(hits('tags:sweet')).toEqual([a]);
    run(`DELETE FROM tag WHERE name = 'sweet'`);
    expectInSync();
    expect(hits('tags:sweet')).toEqual([]);
  });

  it('delete recipe removes the FTS row and cascades children (G20)', () => {
    const u = fresh();
    const r = addRecipe(u, 'Gone');
    addIngredient(r, 'x');
    addTag(r, 'soup');
    run(`DELETE FROM recipe WHERE id = ?`, r);
    expect(fts()).toEqual([]);
    expect(all(`SELECT * FROM recipe_tag`)).toEqual([]);
    expect(all(`SELECT * FROM ingredient`)).toEqual([]);
    expect(all(`SELECT * FROM tag`)).toHaveLength(1); // tags outlive recipes
  });

  it('copy (insert with copied_from_id + children) is indexed', () => {
    const u = fresh();
    const r = addRecipe(u, 'Orig');
    addIngredient(r, 'milk');
    addTag(r, 'x');
    const cp = addRecipe(u, 'Orig (copy)');
    run(`UPDATE recipe SET copied_from_id = ? WHERE id = ?`, r, cp);
    addIngredient(cp, 'milk');
    addTag(cp, 'x');
    expectInSync();
    expect(fts()).toHaveLength(2);
  });

  it('matches case-insensitively, without diacritics, and by prefix', () => {
    const u = fresh();
    const r = addRecipe(u, 'Crème Caramel', 'ESPRESSO glaze');
    expect(hits('creme')).toEqual([r]);
    expect(hits('espresso')).toEqual([r]);
    expect(hits('esp*')).toEqual([r]);
    expect(hits('car*')).toEqual([r]);
  });

  it('1000 inserts then deletes leave no extra rows', () => {
    const u = fresh();
    const ids: string[] = [];
    c().transaction(() => {
      for (let i = 0; i < 1000; i++) ids.push(addRecipe(u, `Recipe ${i}`));
    })();
    expect(one<{ n: number }>(`SELECT count(*) n FROM recipe_fts`).n).toBe(1000);
    c().transaction(() => {
      for (const id of ids) run(`DELETE FROM recipe WHERE id = ?`, id);
    })();
    expect(one<{ n: number }>(`SELECT count(*) n FROM recipe_fts`).n).toBe(0);
  });
});

describe('tag constraints', () => {
  it('rejects empty and over-40-char names and duplicate names', () => {
    fresh();
    expect(() => tagId('')).toThrow(/CHECK/);
    expect(() => tagId('x'.repeat(41))).toThrow(/CHECK/);
    expect(() => tagId('x'.repeat(40))).not.toThrow();
    tagId('dup');
    expect(() =>
      run(`INSERT INTO tag (id, name, created_at) VALUES ('Zdup', 'dup', ?)`, NOW),
    ).toThrow(/UNIQUE/);
  });

  it('allows 20 tags per recipe and aborts the 21st', () => {
    const u = fresh();
    const r = addRecipe(u, 'Tagged');
    for (let i = 0; i < 20; i++) addTag(r, `t${i}`);
    expect(() => addTag(r, 't20')).toThrow(/recipe_tag_limit/);
    expect(one<{ n: number }>(`SELECT count(*) n FROM recipe_tag WHERE recipe_id = ?`, r).n).toBe(
      20,
    );
    const other = addRecipe(u, 'Other');
    expect(() => addTag(other, 't20')).not.toThrow();
  });
});

describe('invariant: index matches source after random writes', () => {
  it('stays in sync through 200 seeded mixed writes', () => {
    const u = fresh();
    let state = 123456789;
    const rnd = (n: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % n;
    };
    const words = ['butter', 'crème', 'Flour', 'espresso', 'sugar', 'ÉCLAIR', 'salt', 'melted'];
    const w = () => words[rnd(words.length)];
    const tags = ['dessert', 'quick', 'vegan', 'soup', 'brunch'];
    const recipes: string[] = [];
    const pick = () => recipes[rnd(recipes.length)];

    for (let i = 0; i < 200; i++) {
      const op = recipes.length === 0 ? 0 : rnd(10);
      if (op <= 1) recipes.push(addRecipe(u, `${w()} ${w()}`, rnd(2) ? w() : null));
      else if (op === 2)
        run(
          `UPDATE recipe SET title = ?, description = ? WHERE id = ?`,
          w(),
          rnd(2) ? w() : null,
          pick(),
        );
      else if (op === 3) addIngredient(pick(), w(), rnd(2) ? w() : null);
      else if (op === 4) {
        const ing = one<{ id: string } | undefined>(
          `SELECT id FROM ingredient WHERE recipe_id = ? LIMIT 1`,
          pick(),
        );
        if (ing) run(`UPDATE ingredient SET name = ?, note = ? WHERE id = ?`, w(), w(), ing.id);
      } else if (op === 5) {
        // PUT-style replace
        const r = pick();
        run(`DELETE FROM ingredient WHERE recipe_id = ?`, r);
        for (let k = rnd(4); k > 0; k--) addIngredient(r, w());
      } else if (op === 6) addTag(pick(), tags[rnd(tags.length)]);
      else if (op === 7)
        run(
          `DELETE FROM recipe_tag WHERE recipe_id = ? AND tag_id = ?`,
          pick(),
          tagId(tags[rnd(tags.length)]),
        );
      else if (op === 8) {
        run(
          `UPDATE tag SET name = ? WHERE name = ?`,
          `${tags[rnd(tags.length)]}-${i}`,
          tags[rnd(tags.length)],
        );
      } else {
        const r = pick();
        run(`DELETE FROM recipe WHERE id = ?`, r);
        recipes.splice(recipes.indexOf(r), 1);
      }
      if (i % 20 === 0) expectInSync();
    }
    expectInSync();
    expect(fts()).toHaveLength(recipes.length);
    expect(c().pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    // FTS5's own consistency check (throws on corruption).
    c().exec(`INSERT INTO recipe_fts(recipe_fts) VALUES ('integrity-check')`);
  });
});
