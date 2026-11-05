import { isCsrfSafe } from '@/lib/auth/csrf';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getEnv } from '@/lib/env';
import type { User } from '@/lib/db/users';
import type { Failure } from './service';

export const json = (status: number, body: unknown): Response => Response.json(body, { status });

/** Map a service failure to its HTTP response (422 carries field errors). */
export function failure(f: Failure): Response {
  return f.status === 422
    ? json(422, { errors: f.errors })
    : new Response(null, { status: f.status });
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

/**
 * Parse a JSON body. Requires `Content-Type: application/json` (415 otherwise, which also
 * keeps cross-site simple-form posts out); invalid JSON is 400. Returns a Response on failure.
 */
export async function readJson(request: Request): Promise<{ body: unknown } | Response> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return json(415, { error: 'unsupported_media_type' });
  try {
    return { body: await request.json() };
  } catch {
    return json(400, { error: 'invalid_json' });
  }
}
