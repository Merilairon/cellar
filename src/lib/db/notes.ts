import { and, asc, eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Db } from './connection';
import { RecipeGuardError, type RecipeGuard } from './recipes';
import { note, nowIso, recipe, user } from './schema';

/** At most this many notes per user per recipe (Q16, G12). */
export const MAX_NOTES_PER_USER_RECIPE = 200;

export class NoteLimitError extends Error {
  constructor() {
    super('note limit reached');
  }
}

export type NoteItem = {
  id: string;
  body: string;
  shared: boolean;
  author: string;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Decides what the caller may do with a note they do not own (recipe owner/admin delete shared). */
export type NoteDeletePolicy = (row: {
  ownerId: string;
  visibility: 'private' | 'users';
}) => boolean;

/**
 * The caller's own notes plus other users' shared notes. The visibility predicate lives in the
 * query itself; a private note of another user is never selected (not even for an admin).
 */
export function listNotes(db: Db, recipeId: string, me: string): NoteItem[] {
  return db
    .select({
      id: note.id,
      body: note.body,
      shared: note.shared,
      userId: note.userId,
      author: user.displayName,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .innerJoin(user, eq(user.id, note.userId))
    .where(and(eq(note.recipeId, recipeId), sql`(${note.shared} = 1 OR ${note.userId} = ${me})`))
    .orderBy(asc(note.createdAt), asc(note.id))
    .all()
    .map(({ userId, ...n }) => ({ ...n, mine: userId === me }));
}

function toItem(n: typeof note.$inferSelect, me: string, author: string): NoteItem {
  return {
    id: n.id,
    body: n.body,
    shared: n.shared,
    author,
    mine: n.userId === me,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

/** Insert a note for `me`. The recipe guard and the 200 cap are checked inside the transaction. */
export function insertNote(
  db: Db,
  recipeId: string,
  me: { id: string; displayName: string },
  input: { body: string; shared: boolean },
  guard: RecipeGuard,
): NoteItem | null {
  return db.transaction(
    (tx) => {
      const r = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!r) return null;
      const verdict = guard(r);
      if (verdict !== 'ok') throw new RecipeGuardError(verdict);
      const count = tx
        .select({ n: sql<number>`count(*)` })
        .from(note)
        .where(and(eq(note.recipeId, recipeId), eq(note.userId, me.id)))
        .get()!.n;
      if (count >= MAX_NOTES_PER_USER_RECIPE) throw new NoteLimitError();
      const row = tx
        .insert(note)
        .values({ id: ulid(), recipeId, userId: me.id, body: input.body, shared: input.shared })
        .returning()
        .get();
      return toItem(row, me.id, me.displayName);
    },
    { behavior: 'immediate' },
  );
}

/** Edit by the author only. Another user's, missing, or other-recipe note id returns null. */
export function updateNote(
  db: Db,
  recipeId: string,
  noteId: string,
  me: { id: string; displayName: string },
  input: { body?: string; shared?: boolean },
  guard: RecipeGuard,
): NoteItem | null {
  return db.transaction(
    (tx) => {
      const r = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!r) return null;
      const verdict = guard(r);
      if (verdict !== 'ok') throw new RecipeGuardError(verdict);
      const cur = tx
        .select()
        .from(note)
        .where(and(eq(note.id, noteId), eq(note.recipeId, recipeId), eq(note.userId, me.id)))
        .get();
      if (!cur) return null;
      const row = tx
        .update(note)
        .set({
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.shared !== undefined ? { shared: input.shared } : {}),
          updatedAt: nowIso(),
        })
        .where(eq(note.id, noteId))
        .returning()
        .get();
      return toItem(row, me.id, me.displayName);
    },
    { behavior: 'immediate' },
  );
}

/**
 * Delete: the author, or (for a SHARED note only) whoever `mayModerate` allows on the recipe
 * (owner/admin). Anything else, including another user's private note, is indistinguishable
 * from a missing note: returns false.
 */
export function deleteNote(
  db: Db,
  recipeId: string,
  noteId: string,
  me: string,
  guard: RecipeGuard,
  mayModerate: NoteDeletePolicy,
): boolean {
  return db.transaction(
    (tx) => {
      const r = tx.select().from(recipe).where(eq(recipe.id, recipeId)).get();
      if (!r) return false;
      const verdict = guard(r);
      if (verdict !== 'ok') throw new RecipeGuardError(verdict);
      const cur = tx
        .select()
        .from(note)
        .where(and(eq(note.id, noteId), eq(note.recipeId, recipeId)))
        .get();
      if (!cur) return false;
      const allowed = cur.userId === me || (cur.shared && mayModerate(r));
      if (!allowed) return false;
      tx.delete(note).where(eq(note.id, noteId)).run();
      return true;
    },
    { behavior: 'immediate' },
  );
}
