/**
 * Document title for a page named after user content (a recipe). Whitespace-only and empty
 * titles fall back to `fallback`, so `<title>` is never blank (WCAG 2.4.2). The Next title
 * template in the root layout appends the product name.
 */
export function contentTitle(raw: string | null | undefined, fallback: string): string {
  const trimmed = (raw ?? '').replace(/\s+/g, ' ').trim();
  return trimmed === '' ? fallback : trimmed;
}
