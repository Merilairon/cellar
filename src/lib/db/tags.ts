import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Db } from './connection';
import { readableBy } from './readable';
import { nowIso, recipe, recipeTag, tag } from './schema';
import { normalizeTagName } from '@/lib/recipes/tag-name';

// Data access for tags. Names are stored in their normalized (lowercase) form; see
// src/lib/recipes/tag-name.ts. Every write here runs inside the caller's transaction.

export { normalizeTagName };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

export const MAX_AUTOCOMPLETE = 10;

/** The migration-0005 backstop trigger refused a 21st tag on one recipe. */
export class TagLimitError extends Error {
  constructor() {
    super('recipe_tag_limit');
  }
}

function isLimitError(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur instanceof Error && i < 4; i++) {
    if (cur.message.includes('recipe_tag_limit')) return true;
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  return false;
}

/** Sorted tag names of one recipe. */
export function listTagsForRecipe(conn: Conn, recipeId: string): string[] {
  return conn
    .select({ name: tag.name })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(eq(recipeTag.recipeId, recipeId))
    .orderBy(asc(tag.name))
    .all()
    .map((r) => r.name);
}

/** Delete the given tags that no recipe uses any more (no background job; same transaction). */
export function deleteOrphanTags(conn: Conn, tagIds: string[]): void {
  if (tagIds.length === 0) return;
  conn
    .delete(tag)
    .where(
      and(
        inArray(tag.id, tagIds),
        notExists(
          conn
            .select({ one: sql`1` })
            .from(recipeTag)
            .where(eq(recipeTag.tagId, tag.id)),
        ),
      ),
    )
    .run();
}

/**
 * Make `names` the exact tag set of a recipe: find-or-create tags, drop links that are no
 * longer wanted (and tags left without any recipe), add new links. Removals happen before
 * inserts so swapping one full set of 20 for another never trips the DB limit. Throws
 * TagLimitError past 20 and a plain Error for a name that fails normalization. The caller's
 * transaction rolls back on either.
 */
export function setRecipeTags(conn: Conn, recipeId: string, names: readonly string[]): void {
  const wanted = new Set<string>();
  for (const raw of names) {
    const n = normalizeTagName(raw);
    if (n === null) throw new Error('invalid tag name');
    wanted.add(n);
  }
  const current = conn
    .select({ tagId: recipeTag.tagId, name: tag.name })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(eq(recipeTag.recipeId, recipeId))
    .all();
  const have = new Set(current.map((c) => c.name));
  const drop = current.filter((c) => !wanted.has(c.name)).map((c) => c.tagId);
  if (drop.length > 0) {
    conn
      .delete(recipeTag)
      .where(and(eq(recipeTag.recipeId, recipeId), inArray(recipeTag.tagId, drop)))
      .run();
    deleteOrphanTags(conn, drop);
  }
  const add = [...wanted].filter((n) => !have.has(n));
  try {
    for (const name of add) {
      conn
        .insert(tag)
        .values({ id: ulid(), name, createdAt: nowIso() })
        .onConflictDoNothing()
        .run();
      const row = conn.select({ id: tag.id }).from(tag).where(eq(tag.name, name)).get()!;
      conn.insert(recipeTag).values({ recipeId, tagId: row.id }).run();
    }
  } catch (e) {
    if (isLimitError(e)) throw new TagLimitError();
    throw e;
  }
}

/** Ids of the tags linked to a recipe (call before deleting the recipe to clean up orphans). */
export function tagIdsForRecipe(conn: Conn, recipeId: string): string[] {
  return conn
    .select({ id: recipeTag.tagId })
    .from(recipeTag)
    .where(eq(recipeTag.recipeId, recipeId))
    .all()
    .map((r) => r.id);
}

export type TagCount = { name: string; count: number };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

function readableTagCounts(
  db: Db,
  userId: string,
  opts: { prefix?: string; limit?: number },
): TagCount[] {
  // The prefix is user text: normalized the way names are stored, then LIKE-escaped.
  const prefix = (opts.prefix ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
  const count = sql<number>`count(distinct ${recipe.id})`;
  const q = db
    .select({ name: tag.name, count })
    .from(tag)
    .innerJoin(recipeTag, eq(recipeTag.tagId, tag.id))
    .innerJoin(recipe, eq(recipe.id, recipeTag.recipeId))
    .where(
      and(
        readableBy(userId),
        prefix === '' ? undefined : sql`${tag.name} LIKE ${escapeLike(prefix) + '%'} ESCAPE '\\'`,
      ),
    )
    .groupBy(tag.id)
    .orderBy(desc(count), asc(tag.name));
  return (opts.limit === undefined ? q : q.limit(opts.limit)).all();
}

/** Autocomplete: tags on recipes the user can read, matching a prefix, with counts (max 10). */
export function listReadableTags(
  db: Db,
  userId: string,
  opts: { prefix?: string; limit?: number } = {},
): TagCount[] {
  return readableTagCounts(db, userId, {
    prefix: opts.prefix,
    limit: Math.min(opts.limit ?? MAX_AUTOCOMPLETE, MAX_AUTOCOMPLETE),
  });
}

/** All tags on readable recipes with counts, for filter chips. Counts include readable recipes only. */
export function listTagCounts(db: Db, userId: string): TagCount[] {
  return readableTagCounts(db, userId, {});
}
