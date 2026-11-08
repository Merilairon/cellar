import { getDb } from '@/lib/db';
import { authenticate, failure, json, noStore, readJson } from '@/lib/recipes/http';
import { NOTE_BODY_MAX, checkNoteRead, deleteNoteFor, updateNoteFor } from '@/lib/recipes/notes';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; noteId: string }> };

export async function PUT(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const { id, noteId } = await params;
  const db = getDb();
  const pre = checkNoteRead(db, auth.user, id);
  if (!pre.ok) return noStore(failure(pre));
  const parsed = await readJson(request, NOTE_BODY_MAX);
  if (parsed instanceof Response) return noStore(parsed);
  const result = updateNoteFor(db, auth.user, id, noteId, parsed.body);
  return noStore(result.ok ? json(200, result.note) : failure(result));
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const { id, noteId } = await params;
  const result = deleteNoteFor(getDb(), auth.user, id, noteId);
  return noStore(result.ok ? new Response(null, { status: 204 }) : failure(result));
}
