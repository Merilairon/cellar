import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { LimiterBusyError, busyResponse } from '@/lib/import/limiter';
import { authenticate, failure, json, noStore, readCappedBytes } from '@/lib/recipes/http';
import { UPLOAD_RETRY_AFTER_SEC, tryAcquireUpload } from '@/lib/recipes/upload-gate';
import { checkPhotoWrite, listPhotosFor, photoFailure, uploadPhotoFor } from '@/lib/recipes/photos';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const result = listPhotosFor(getDb(), auth.user, (await params).id);
  return noStore(result.ok ? json(200, { photos: result.photos }) : failure(result));
}

/**
 * Upload: the request body IS the image (raw bytes, `Content-Type: image/*`, no multipart;
 * decision from the T0 spike). Order: CSRF (403), session (401), recipe access (404/403),
 * then the upload gate (503 when 3 are in flight), the capped read (415/413/408), then validation (422) and the decode (503 when busy). The
 * declared type is only a hint: magic bytes decide. `proxy.ts` truncates silently above its
 * limit, so the 10 MiB cap is enforced here while streaming.
 */
export async function POST(request: Request, { params }: Ctx) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return noStore(auth);
  const db = getDb();
  const id = (await params).id;
  const pre = checkPhotoWrite(db, auth.user, id);
  if (!pre.ok) return noStore(failure(pre));
  // Process-wide bound on bodies being buffered/processed (M1): full -> 503, never queued.
  const release = tryAcquireUpload();
  if (!release) return noStore(busyResponse(new LimiterBusyError(UPLOAD_RETRY_AFTER_SEC)));
  try {
    const body = await readCappedBytes(request);
    if (body instanceof Response) return noStore(body);
    const result = await uploadPhotoFor(db, auth.user, id, body.bytes, {
      uploadsDir: getEnv().UPLOADS_DIR,
    });
    return noStore(result.ok ? json(201, result.photo) : photoFailure(result));
  } finally {
    release();
  }
}
