import { desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from './connection';
import { readableBy } from './readable';
import { recipe, user } from './schema';
import { normalizeTagName } from '@/lib/recipes/tag-name';

// Recipe search over recipe_fts (migration 0005). User text never reaches MATCH raw: it is
// tokenised here, every token is double-quoted and gets a prefix `*` appended by code, so FTS5
// operators, column filters and quotes typed by a user are inert text. Visibility is enforced
// in the same SQL statement via readableBy (tasklist G4).

export const MAX_QUERY_CHARS = 100;
export const MAX_QUERY_TOKENS = 8;
export const MIN_TOKEN_CHARS = 2;
export const SEARCH_RESULT_CAP = 100;

/**
 * Build the FTS5 MATCH expression from raw user text, or null when nothing searchable is
 * left (callers return an empty list in that case, never the whole table). Tokens are runs of
 * letters, digits and combining marks (NFC, first 100 characters, at most 8 tokens of >= 2
 * characters); everything else is a separator. Tokens are ANDed (space) with prefix matching.
 */
export function buildMatchQuery(raw: string): string | null {
  const text = [...raw.normalize('NFC')].slice(0, MAX_QUERY_CHARS).join('');
  const tokens = (text.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])
    .filter((t) => [...t].length >= MIN_TOKEN_CHARS)
    .slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return null;
  // Tokens contain no quote characters by construction; the replace is belt and braces.
  return tokens.map((t) => `"${t.replaceAll('"', '')}"*`).join(' ');
}

export type SearchOptions = {
  q?: string;
  /** Tag name; normalized like stored names. */
  tag?: string;
  /** A user id, or 'me' for the caller. */
  author?: string;
  limit?: number;
};

export type RecipeSearchItem = {
  id: string;
  title: string;
  ownerId: string;
  ownerDisplayName: string;
  visibility: 'private' | 'users';
  viewMode: 'grid' | 'list';
  updatedAt: string;
  tags: string[];
};

type Row = Omit<RecipeSearchItem, 'tags'> & { tagList: string | null };

/**
 * Recipes the user may read, optionally filtered by `q` (FTS, bm25 ranked), `tag` and
 * `author` (all ANDed). Without `q`: newest first, no cap (the v0.3.2 list). With `q`: bm25
 * with column weights title 10, tags 6, ingredients 4, description 2, notes 1; ties by
 * updated_at desc, id desc; capped at 100 rows.
 */
export function searchRecipes(
  db: Db,
  userId: string,
  opts: SearchOptions = {},
): RecipeSearchItem[] {
  const hasQ = opts.q !== undefined && opts.q.trim() !== '';
  const match = hasQ ? buildMatchQuery(opts.q!) : null;
  if (hasQ && match === null) return [];

  const where: SQL[] = [readableBy(userId)!];
  if (opts.tag !== undefined) {
    const name = normalizeTagName(opts.tag);
    if (name === null) return [];
    where.push(sql`exists (select 1 from recipe_tag rt join tag t on t.id = rt.tag_id
      where rt.recipe_id = ${recipe.id} and t.name = ${name})`);
  }
  if (opts.author !== undefined) {
    where.push(eq(recipe.ownerId, opts.author === 'me' ? userId : opts.author));
  }
  const cols = sql`${recipe.id} as id, ${recipe.title} as title, ${recipe.ownerId} as ownerId,
    ${user.displayName} as ownerDisplayName, ${recipe.visibility} as visibility,
    ${recipe.viewMode} as viewMode, ${recipe.updatedAt} as updatedAt,
    (select group_concat(t2.name, char(31)) from recipe_tag rt2 join tag t2 on t2.id = rt2.tag_id
      where rt2.recipe_id = ${recipe.id}) as tagList`;
  const cond = sql.join(where, sql` and `);

  let stmt: SQL;
  if (match !== null) {
    const cap = Math.min(opts.limit ?? SEARCH_RESULT_CAP, SEARCH_RESULT_CAP);
    stmt = sql`select ${cols} from recipe_fts
      join ${recipe} on ${recipe.id} = recipe_fts.recipe_id
      join ${user} on ${user.id} = ${recipe.ownerId}
      where recipe_fts match ${match} and ${cond}
      order by bm25(recipe_fts, 0, 10, 2, 4, 6, 1), ${recipe.updatedAt} desc, ${recipe.id} desc
      limit ${cap}`;
  } else {
    stmt = sql`select ${cols} from ${recipe}
      join ${user} on ${user.id} = ${recipe.ownerId}
      where ${cond}
      order by ${desc(recipe.updatedAt)}, ${desc(recipe.id)}
      ${opts.limit !== undefined ? sql`limit ${opts.limit}` : sql``}`;
  }
  return db.all<Row>(stmt).map(({ tagList, ...r }) => ({
    ...r,
    tags: tagList ? tagList.split('\u001f').sort() : [],
  }));
}
