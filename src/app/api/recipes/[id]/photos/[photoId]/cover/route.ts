import { getDb } from '@/lib/db';
import { authenticate, failure, json, noStore } from '@/lib/recipes/http';
import { setCoverFor } from '@/lib/recipes/photos';

export const dynamic = 'force-dynamic';

/**
 * Set the cover. Nested under the recipe (chosen over `PUT /api/photos/:id/cover`) so the
 * recipe id in the URL is part of the authorization: a photo id that belongs to another recipe
 * is a 404, never a cross-recipe write. Writes need canWrite (403 for a reader, 404 when the
 * recipe is unreadable). Responds with the recipe's photos in order.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const { id, photoId } = await params;
  const result = setCoverFor(getDb(), auth.user, id, photoId);
  return noStore(result.ok ? json(200, { photos: result.photos }) : failure(result));
}
