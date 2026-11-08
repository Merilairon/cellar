import { z } from 'zod';
import type { Db } from '@/lib/db/connection';
import {
  deleteNote,
  insertNote,
  listNotes,
  NoteLimitError,
  updateNote,
  type NoteItem,
} from '@/lib/db/notes';
import { getRecipeRow, RecipeGuardError, type RecipeGuard } from '@/lib/db/recipes';
import { canRead, canWrite } from './access';
import { zodIssuesToErrors, type FieldError } from './schemas';
import type { Actor } from './service';

/** Body cap (bytes) for note JSON endpoints: 4000 characters is at most 16000 UTF-8 bytes. */
export const NOTE_BODY_MAX = 16 * 1024;

export const NOTE_MAX_CHARS = 4000;

type Failure = { ok: false; status: 404 } | { ok: false; status: 422; errors: FieldError[] };

const noteText = z
  .string()
  .trim()
  .min(1)
  .max(NOTE_MAX_CHARS)
  .refine((s) => !s.includes('\u0000'), { message: 'nul_char' });

export const noteCreateSchema = z.strictObject({
  body: noteText,
  shared: z.boolean().default(false),
});

export const noteUpdateSchema = z
  .strictObject({ body: noteText.optional(), shared: z.boolean().optional() })
  .refine((v) => v.body !== undefined || v.shared !== undefined, {
    message: 'too_small',
  });

export type ApiNote = {
  id: string;
  body: string;
  shared: boolean;
  author: string;
  mine: boolean;
  created_at: string;
  updated_at: string;
};

const toApi = (n: NoteItem): ApiNote => ({
  id: n.id,
  body: n.body,
  shared: n.shared,
  author: n.author,
  mine: n.mine,
  created_at: n.createdAt,
  updated_at: n.updatedAt,
});

// Any reader may use notes (Q3), including on a read-only `users` recipe.
const readGuard =
  (actor: Actor): RecipeGuard =>
  (row) =>
    canRead(actor, row) ? 'ok' : 'not_found';

const invalid = (error: z.ZodError): Failure => ({
  ok: false,
  status: 422,
  errors: zodIssuesToErrors(error),
});

function guarded<T>(fn: () => T): { ok: true; value: T } | Failure {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof RecipeGuardError) return { ok: false, status: 404 };
    if (e instanceof NoteLimitError) {
      return { ok: false, status: 422, errors: [{ path: 'body', code: 'note_limit' }] };
    }
    throw e;
  }
}

/** Cheap pre-check before the body is read (404 when missing or unreadable, like every note op). */
export function checkNoteRead(db: Db, actor: Actor, recipeId: string): { ok: true } | Failure {
  const row = getRecipeRow(db, recipeId);
  return row && canRead(actor, row) ? { ok: true } : { ok: false, status: 404 };
}

export function listNotesFor(
  db: Db,
  actor: Actor,
  recipeId: string,
): { ok: true; notes: ApiNote[] } | Failure {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  return { ok: true, notes: listNotes(db, recipeId, actor.id).map(toApi) };
}

type Me = Actor & { displayName: string };

export function createNoteFor(
  db: Db,
  actor: Me,
  recipeId: string,
  body: unknown,
): { ok: true; note: ApiNote } | Failure {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  const parsed = noteCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const res = guarded(() => insertNote(db, recipeId, actor, parsed.data, readGuard(actor)));
  if (!res.ok) return res;
  return res.value ? { ok: true, note: toApi(res.value) } : { ok: false, status: 404 };
}

export function updateNoteFor(
  db: Db,
  actor: Me,
  recipeId: string,
  noteId: string,
  body: unknown,
): { ok: true; note: ApiNote } | Failure {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  const parsed = noteUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const res = guarded(() => updateNote(db, recipeId, noteId, actor, parsed.data, readGuard(actor)));
  if (!res.ok) return res;
  return res.value ? { ok: true, note: toApi(res.value) } : { ok: false, status: 404 };
}

export function deleteNoteFor(
  db: Db,
  actor: Actor,
  recipeId: string,
  noteId: string,
): { ok: true } | Failure {
  const row = getRecipeRow(db, recipeId);
  if (!row || !canRead(actor, row)) return { ok: false, status: 404 };
  const res = guarded(() =>
    deleteNote(db, recipeId, noteId, actor.id, readGuard(actor), (r) => canWrite(actor, r)),
  );
  if (!res.ok) return res;
  return res.value ? { ok: true } : { ok: false, status: 404 };
}
