import { getDb } from '@/lib/db';
import { authenticate, failure, json, noStore, readJson } from '@/lib/recipes/http';
import { NOTE_BODY_MAX, checkNoteRead, createNoteFor, listNotesFor } from '@/lib/recipes/notes';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const result = listNotesFor(getDb(), auth.user, (await params).id);
  return noStore(result.ok ? json(200, { notes: result.notes }) : failure(result));
}

export async function POST(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const db = getDb();
  const id = (await params).id;
  const pre = checkNoteRead(db, auth.user, id);
  if (!pre.ok) return noStore(failure(pre));
  const parsed = await readJson(request, NOTE_BODY_MAX);
  if (parsed instanceof Response) return noStore(parsed);
  const result = createNoteFor(db, auth.user, id, parsed.body);
  return noStore(result.ok ? json(201, result.note) : failure(result));
}
