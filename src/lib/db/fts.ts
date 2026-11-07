import { sql } from 'drizzle-orm';
import type { Db } from './connection';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

/**
 * Bulk writers (create, replace, copy, import) write many ingredient and tag rows for one
 * recipe. The per-row FTS triggers would rebuild the whole index row each time, which is
 * quadratic (security checkpoint F1). Migration 0006 makes those triggers skip a recipe that
 * has a marker in recipe_fts_defer; this helper sets the marker, runs `fn`, clears it and
 * reindexes the recipe once. Call inside the caller's transaction so a failure rolls the
 * marker back with everything else.
 */
export function withDeferredFts<T>(conn: Conn, recipeId: string, fn: () => T): T {
  conn.run(sql`insert or ignore into recipe_fts_defer (recipe_id) values (${recipeId})`);
  let result: T;
  try {
    result = fn();
  } finally {
    conn.run(sql`delete from recipe_fts_defer where recipe_id = ${recipeId}`);
  }
  reindexRecipe(conn, recipeId);
  return result;
}

/** Rebuild one recipe's FTS row from the source tables (same SQL as the 0005 triggers). */
export function reindexRecipe(conn: Conn, recipeId: string): void {
  conn.run(sql`delete from recipe_fts where recipe_id = ${recipeId}`);
  conn.run(sql`insert into recipe_fts (recipe_id, title, description, ingredients, tags, notes)
    select r.id, r.title, coalesce(r.description, ''),
      coalesce((select group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' order by i.id)
        from ingredient i where i.recipe_id = r.id), ''),
      coalesce((select group_concat(t.name, ' ' order by t.name)
        from recipe_tag rt join tag t on t.id = rt.tag_id where rt.recipe_id = r.id), ''),
      ''
    from recipe r where r.id = ${recipeId}`);
}
