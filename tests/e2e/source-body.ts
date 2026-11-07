/** Marker line that starts the part of a spec the source-check tests scan (split so it never matches itself). */
export const BODY_MARKER = '// ----' + ' body';

/**
 * The spec source below the marker. Throws when the marker is missing: `slice(-1)` would
 * otherwise scan one character and every banned-word check would pass vacuously (review m10).
 */
export function sourceBody(src: string): string {
  const at = src.lastIndexOf(BODY_MARKER);
  if (at < 0)
    throw new Error(`source marker "${BODY_MARKER}" not found; the check would scan nothing`);
  return src.slice(at);
}
