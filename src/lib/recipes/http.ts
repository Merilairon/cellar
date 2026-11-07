import { isCsrfSafe } from '@/lib/auth/csrf';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getEnv } from '@/lib/env';
import type { User } from '@/lib/db/users';
import type { Failure } from './service';

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
