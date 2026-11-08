import { readFile } from 'node:fs/promises';
import { getDb } from '@/lib/db';
import { getPhoto } from '@/lib/db/photos';
import { getRecipeRow } from '@/lib/db/recipes';
import { getEnv } from '@/lib/env';
import { resolveUploadPath } from '@/lib/import/uploads';
import { canRead } from '@/lib/recipes/access';
import { authenticate, failure, json, noStore } from '@/lib/recipes/http';
import { deletePhotoFor } from '@/lib/recipes/photos';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const IMAGE_HEADERS = {
  'Content-Type': 'image/webp',
  'Cache-Control': 'private, no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Content-Disposition': 'inline; filename="photo.webp"',
};

/** True when `If-None-Match` lists (or wildcards) our strong tag. Weak prefixes are tolerated. */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

/**
 * Keyed by photo id only; the file path comes from the DB row, never from the client.
 * `?size=thumb` serves the 400 px file (a legacy row without one serves the full image, G1);
 * any other `size` value is 400. The ETag names the photo id and the variant actually served:
 * an id is immutable content, and a deleted photo is 404 before the tag is ever compared.
 */
export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const query = new URL(request.url).searchParams;
  const sizes = query.getAll('size');
  if (sizes.length > 1 || (sizes.length === 1 && sizes[0] !== 'thumb')) {
    return noStore(json(400, { error: 'invalid_query' }));
  }
  const db = getDb();
  const p = getPhoto(db, (await params).id);
  const recipe = p ? getRecipeRow(db, p.recipeId) : undefined;
  if (!p || !recipe || !canRead(auth.user, recipe))
    return noStore(new Response(null, { status: 404 }));
  const useThumb = sizes.length === 1 && p.thumbPath !== null;
  const rel = useThumb ? p.thumbPath! : p.filePath;
  const etag = `"${p.id}-${useThumb ? 'thumb' : 'full'}"`;
  if (etagMatches(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { ...IMAGE_HEADERS, ETag: etag } });
  }
  const abs = resolveUploadPath(getEnv().UPLOADS_DIR, rel);
  if (!abs) return noStore(new Response(null, { status: 404 }));
  try {
    const data = await readFile(abs);
    return new Response(new Uint8Array(data), { headers: { ...IMAGE_HEADERS, ETag: etag } });
  } catch {
    return noStore(new Response(null, { status: 404 }));
  }
}

/** canWrite (owner or admin): 403 for a reader of a `users` recipe, 404 when unreadable. */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const db = getDb();
  const p = getPhoto(db, (await params).id);
  if (!p) return noStore(new Response(null, { status: 404 }));
  const result = deletePhotoFor(db, auth.user, p.recipeId, p.id, getEnv().UPLOADS_DIR);
  return noStore(result.ok ? new Response(null, { status: 204 }) : failure(result));
}
