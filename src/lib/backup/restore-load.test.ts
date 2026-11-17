import { afterEach, describe, expect, it } from 'vitest';
import { count } from 'drizzle-orm';
import type { Db } from '@/lib/db/connection';
import { INSERT_CHUNK, insertRecipeTree } from '@/lib/db/recipes';
import { ingredient, recipe } from '@/lib/db/schema';
import { migrateBackup } from './migrate';
import { applyRestore } from './restore';
import { viaJson } from './restore-test-util';
import { MAX_TOTAL_ROWS, checkCaps } from './schema';
import { validDoc, validRecipe } from './schema-fixtures';
import { memDb, mkUser } from './test-fixtures';
import { backupRecipeToTree } from './toTree';

// v1.0 security review H1: a restore of many rows must not freeze the process (one native
// statement per row, no yield) and the total row count is capped before anything is applied.

const dbs: Db[] = [];
afterEach(() => {
  while (dbs.length) dbs.pop()!.$client.close();
});

function bigDoc(recipes: number, ingredients: number) {
  const base = validRecipe();
  const ing = base.sections[0]!.ingredients[0]!;
  return viaJson({
    ...validDoc(),
    recipes: Array.from({ length: recipes }, (_, r) => ({
      ...base,
      title: `R${r}`,
      photos: [],
      sections: [
        {
          ...base.sections[0]!,
          ingredients: Array.from({ length: ingredients }, (_, i) => ({ ...ing, position: i })),
        },
      ],
    })),
  });
}

describe('restore apply load (H1)', () => {
  it('yields to the event loop between recipes: a timer scheduled before the apply fires during it', async () => {
    const db = memDb();
    dbs.push(db);
    const u = mkUser(db, 'a@x.test');
    const doc = bigDoc(8, 200);
    let seenAtFire = -1;
    setTimeout(() => {
      seenAtFire = db.select({ n: count() }).from(recipe).get()!.n;
    }, 0);
    const res = await applyRestore(db, { id: u.id, role: 'member' }, doc, null, 'skip', '/nope');
    expect(res.imported).toBe(8);
    // Fired after some recipes were committed but before the last one: the loop was released.
    expect(seenAtFire).toBeGreaterThan(0);
    expect(seenAtFire).toBeLessThan(8);
  });

  it('inserts ingredients in multi-row statements of INSERT_CHUNK rows', () => {
    const db = memDb();
    dbs.push(db);
    const u = mkUser(db, 'a@x.test');
    const doc = bigDoc(1, 200);
    let statements = 0;
    const counting = new Proxy(db, {
      get(t, k) {
        const v = Reflect.get(t, k, t) as unknown;
        if (k !== 'insert' || typeof v !== 'function') return v;
        return (table: unknown) => {
          if (table === ingredient) statements++;
          return (v as (x: unknown) => unknown).call(t, table);
        };
      },
    });
    insertRecipeTree(counting, u.id, backupRecipeToTree(doc.recipes[0]!));
    expect(db.select({ n: count() }).from(ingredient).get()!.n).toBe(200);
    // Literal bound, not derived from the constant: one statement per row would be 200.
    expect(statements).toBeLessThanOrEqual(4);
    expect(statements).toBe(Math.ceil(200 / INSERT_CHUNK));
  });
});

describe('total row cap (H1)', () => {
  const docWithRows = (rows: number) => {
    const per = 200;
    const sections = Array.from({ length: Math.ceil(rows / per) }, (_, i) => ({
      ingredients: new Array(Math.min(per, rows - i * per)).fill(0),
      steps: [],
    }));
    // 20 sections per recipe is the per-recipe cap
    const recipes = [];
    for (let i = 0; i < sections.length; i += 20)
      recipes.push({ sections: sections.slice(i, i + 20) });
    return { recipes };
  };

  it('accepts exactly MAX_TOTAL_ROWS and refuses one more', () => {
    expect(MAX_TOTAL_ROWS).toBe(250_000);
    expect(checkCaps(docWithRows(250_000))).toEqual([]);
    expect(checkCaps(docWithRows(250_001))).toEqual([{ path: 'recipes', code: 'too_large' }]);
  });

  it('migrateBackup rejects an over-cap document as backup_invalid with too_large', () => {
    const r = migrateBackup({ ...validDoc(), ...docWithRows(250_001) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('backup_invalid');
      expect(JSON.stringify(r)).toContain('too_large');
    }
  });
});
