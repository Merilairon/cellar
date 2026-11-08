import { isCsrfSafe } from '@/lib/auth/csrf';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getEnv } from '@/lib/env';
import type { User } from '@/lib/db/users';
import type { Failure } from './service';
import { uploadReadTimeoutMs } from './upload-gate';

export const json = (status: number, body: unknown): Response => Response.json(body, { status });

export const NO_STORE = 'private, no-store';

/** Mark a response uncacheable (C3). Returns the same response for chaining. */
export function noStore(response: Response): Response {
  response.headers.set('Cache-Control', NO_STORE);
  return response;
}

/** Map a service failure to its HTTP response (422 carries field errors, 409 the current stamp). */
export function failure(f: Failure): Response {
  if (f.status === 422) return json(422, { errors: f.errors });
  if (f.status === 409) return json(409, { error: 'conflict', updated_at: f.currentUpdatedAt });
  return new Response(null, { status: f.status });
}

/**
 * Shared prologue for recipe handlers: CSRF first on mutating methods (403 before any
 * other work), then the session (401).
 */
export async function authenticate(request: Request): Promise<{ user: User } | Response> {
  if (!isCsrfSafe(request.method, request.headers, getEnv().BASE_URL)) {
    return new Response(null, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  return { user };
}

/** Body caps (bytes) for JSON endpoints that accept free text. */
export const IMPORT_BODY_MAX = 1024 * 1024;
export const SAVE_BODY_MAX = 256 * 1024;
/**
 * Grid save cap. Not lowered to SAVE_BODY_MAX: a legitimate payload at the schema ceiling
 * (20 sections x 200 ingredients with short fields) is about 475 KB, and the replace cost is
 * bounded by the row limits (about 0.7 s measured), not by bytes. The cap bounds memory and
 * parse work only (v0.4.1 checkpoint L2).
 */
export const GRID_BODY_MAX = 1024 * 1024;

/**
 * Read the body as text, never buffering more than `maxBytes`. Rejects early on an
 * oversize Content-Length and counts streamed bytes otherwise (chunked or lying header).
 * Returns null when the cap is exceeded.
 */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Parse a JSON body. Requires `Content-Type: application/json` (415 otherwise, which also
 * keeps cross-site simple-form posts out); a body over `maxBytes` is 413 (checked before
 * any parse); invalid JSON is 400. Returns a Response on failure.
 */
export async function readJson(
  request: Request,
  maxBytes: number = IMPORT_BODY_MAX,
): Promise<{ body: unknown } | Response> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return json(415, { error: 'unsupported_media_type' });
  const text = await readCapped(request, maxBytes);
  if (text === null) return json(413, { error: 'payload_too_large' });
  try {
    return { body: JSON.parse(text) };
  } catch {
    return json(400, { error: 'invalid_json' });
  }
}

/** Photo upload cap: exactly 10 MiB is accepted, one byte more is 413 (spec, Q11). */
export const PHOTO_BODY_MAX = 10 * 1024 * 1024;

/**
 * Read a raw `image/*` request body (photo upload), never holding more than `maxBytes`.
 * Order matters: a non-image Content-Type is 415 before anything is read; an oversize
 * Content-Length is 413 before anything is read; a missing or lying length is caught while
 * streaming (the reader is cancelled at the first chunk that crosses the cap, so at most one
 * chunk past the cap is ever pulled). A valid declared length under the cap preallocates the
 * result once and chunks are copied straight in (no second concat copy); a body longer than it
 * declared grows the buffer, still bounded by the cap. The whole read has a deadline
 * (`timeoutMs`, default 30 s): a stalled sender gets 408 `request_timeout`. The type is only a
 * hint: magic bytes decide later. Returns the bytes (possibly zero-length; the caller rejects
 * that) or a Response.
 */
export async function readCappedBytes(
  request: Request,
  maxBytes: number = PHOTO_BODY_MAX,
  opts: { timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array } | Response> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!/^image\/[a-z0-9.+-]+$/.test(type)) return json(415, { error: 'unsupported_media_type' });
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    return json(413, { error: 'payload_too_large' });
  }
  if (!request.body) return { bytes: new Uint8Array(0) };
  const timeoutMs = opts.timeoutMs ?? uploadReadTimeoutMs();
  const n = declared !== null && /^\d+$/.test(declared) ? Number(declared) : 0;
  let buf = new Uint8Array(n > 0 && n <= maxBytes ? n : 0);
  let total = 0;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), timedOut]);
      if (next === 'timeout') {
        reader.cancel().catch(() => undefined);
        return json(408, { error: 'request_timeout' });
      }
      if (next.done) break;
      const chunk = next.value;
      if (total + chunk.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return json(413, { error: 'payload_too_large' });
      }
      if (total + chunk.byteLength > buf.byteLength) {
        const grown = new Uint8Array(
          Math.min(maxBytes, Math.max(total + chunk.byteLength, buf.byteLength * 2, 64 * 1024)),
        );
        grown.set(buf.subarray(0, total));
        buf = grown;
      }
      buf.set(chunk, total);
      total += chunk.byteLength;
    }
  } finally {
    clearTimeout(timer);
  }
  return { bytes: total === buf.byteLength ? buf : buf.subarray(0, total) };
}
