/**
 * Process-wide bound on concurrent photo uploads (AppSec M1). Each in-flight upload may hold up
 * to PHOTO_BODY_MAX of buffered body plus the decode working set, so the number of requests that
 * may be reading or processing a body at once is capped, not just the decode step. When full the
 * route answers 503 + Retry-After instead of queueing (a queued request would hold its socket and
 * a partially read body). Kept on globalThis so separately bundled route modules share one counter.
 */

/** Max uploads reading or processing at the same time (3 x 10 MiB of body buffers at most). */
export const UPLOAD_INFLIGHT_MAX = 3;
/** Deadline for the whole body read; a slow-loris sender is cut off with 408. */
export const UPLOAD_READ_TIMEOUT_MS = 30_000;
/** Retry-After (seconds) sent with a saturated-gate 503. */
export const UPLOAD_RETRY_AFTER_SEC = 5;

type State = { limit: number; readTimeoutMs: number; active: number };
const registry = globalThis as unknown as { __photoUploadGate?: State };
const state = (): State =>
  (registry.__photoUploadGate ??= {
    limit: UPLOAD_INFLIGHT_MAX,
    readTimeoutMs: UPLOAD_READ_TIMEOUT_MS,
    active: 0,
  });

/** Take a slot, or null when the gate is full. Call the returned release exactly once (idempotent). */
export function tryAcquireUpload(): (() => void) | null {
  const s = state();
  if (s.active >= s.limit) return null;
  s.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    s.active--;
  };
}

export const uploadsInFlight = (): number => state().active;
export const uploadReadTimeoutMs = (): number => state().readTimeoutMs;

/** Test seam: override the limit and/or read timeout; returns a function restoring the defaults. */
export function configureUploads(opts: { limit?: number; readTimeoutMs?: number }): () => void {
  const s = state();
  const prev = { limit: s.limit, readTimeoutMs: s.readTimeoutMs };
  if (opts.limit !== undefined) s.limit = opts.limit;
  if (opts.readTimeoutMs !== undefined) s.readTimeoutMs = opts.readTimeoutMs;
  return () => {
    s.limit = prev.limit;
    s.readTimeoutMs = prev.readTimeoutMs;
  };
}
