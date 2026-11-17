import { eq, or } from 'drizzle-orm';
import { recipe } from './schema';

/**
 * The one SQL predicate for "recipes this user may see in lists, search, tags": their own plus
 * `users`-visible ones (v0.4.0 tasklist G4). Admins get no extra reach here, matching the list.
 * Shared so list, search and tag queries cannot drift apart.
 *
 * This is the SQL twin of `canView(actor, row)` (`src/lib/recipes/access.ts`) for a signed-in
 * actor without a share token; `readable.test.ts` enumerates actors x visibilities through both
 * and asserts the same set. The one deliberate difference: an admin may read a private recipe
 * by id (`canView` true) but lists never show it (`readableBy` false); see
 * `docs/tasks/v0.4.2-carryover.md` item 12. Anonymous has no list form: `canView(null, ...)`
 * is only ever true through a share token, one recipe at a time.
 */
export const readableBy = (userId: string) =>
  or(eq(recipe.ownerId, userId), eq(recipe.visibility, 'users'));
