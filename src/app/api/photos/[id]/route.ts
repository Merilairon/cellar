import { readFile } from 'node:fs/promises';
import { getDb } from '@/lib/db';
import { getPhoto } from '@/lib/db/photos';
import { getRecipeRow } from '@/lib/db/recipes';
import { getEnv } from '@/lib/env';
import { resolveUploadPath } from '@/lib/import/uploads';
import { canRead } from '@/lib/recipes/access';
import { authenticate } from '@/lib/recipes/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Keyed by photo id only; the file path comes from the DB row, never from the client. */
export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const db = getDb();
  const p = getPhoto(db, (await params).id);
  const recipe = p ? getRecipeRow(db, p.recipeId) : undefined;
  if (!p || !recipe || !canRead(auth.user, recipe)) return new Response(null, { status: 404 });
  const abs = resolveUploadPath(getEnv().UPLOADS_DIR, p.filePath);
  if (!abs) return new Response(null, { status: 404 });
  try {
    const data = await readFile(abs);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
