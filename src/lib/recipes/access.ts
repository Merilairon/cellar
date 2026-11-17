import { timingSafeEqual } from 'node:crypto';
import type { Visibility } from './schemas';

/**
 * Who is asking. `null` is the anonymous visitor of a public link (`/r/<token>`); every other
 * caller is a signed-in user. Anonymous never gets admin behaviour and can only ever satisfy
 * `canView` through a matching, enabled share token (v1.0 tasklist G1, G24, R3).
 */
export type Actor = { id: string; role: 'admin' | 'member' } | null;

type Owned = { ownerId: string };
type Viewable = Owned & { visibility: Visibility; shareToken: string | null };

/** Share-link context for `canView`; absent for ordinary signed-in requests. */
export type ViewContext = {
  /** Token from the URL, if any. Compared byte-wise against the stored share token. */
  token?: string;
  /** `PUBLIC_LINKS_ENABLED`; false keeps stored tokens inert (Q5). */
  publicLinksEnabled: boolean;
};

/**
 * Constant-time token check. Lengths must match first: `timingSafeEqual` throws on unequal
 * lengths. The early return leaks only the length, which is fixed upstream by the public
 * route's token format gate (T4, R4); on its own this branch reveals nothing else.
 */
function tokenMatches(stored: string, given: string): boolean {
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

/**
 * Read a single recipe. Owner or any admin: yes. Any signed-in user when `visibility` is
 * `users`: yes. Anonymous: only with an enabled, stored, matching share token; the link is
 * independent of `visibility` (data-model section 1). The SQL twin for list queries is
 * `readableBy` in `src/lib/db/readable.ts`; `src/lib/db/readable.test.ts` keeps them in step.
 */
export function canView(actor: Actor, recipe: Viewable, ctx?: ViewContext): boolean {
  if (actor !== null) {
    return actor.role === 'admin' || recipe.ownerId === actor.id || recipe.visibility === 'users';
  }
  // Strict `=== true`: a non-boolean smuggled in at runtime must not enable links.
  if (ctx?.publicLinksEnabled !== true) return false;
  // `typeof` rather than `!== null`: a partial row without the column must be a plain "no",
  // never a thrown Buffer.from(undefined) that turns the uniform 404 into a 500.
  if (typeof recipe.shareToken !== 'string' || recipe.shareToken === '') return false;
  if (typeof ctx.token !== 'string' || ctx.token === '') return false;
  return tokenMatches(recipe.shareToken, ctx.token);
}

/** Write, delete, visibility, sharing and photos: owner or admin only. Anonymous never edits. */
export function canEdit(actor: Actor, recipe: Owned): boolean {
  return actor !== null && (actor.role === 'admin' || recipe.ownerId === actor.id);
}

/**
 * "Imported and never edited" (G8, Q3): a `source_url` is set and no content write has moved
 * `updated_at` off `created_at`. Sharing and visibility changes do not stamp (R5), so they do
 * not clear this. Drives the copyright warning in the share dialog; never blocks anything.
 */
export function isImportedUnedited(recipe: {
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}): boolean {
  return !!recipe.sourceUrl && recipe.updatedAt === recipe.createdAt;
}
