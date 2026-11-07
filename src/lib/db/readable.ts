import { eq, or } from 'drizzle-orm';
import { recipe } from './schema';

/**
 * The one SQL predicate for "recipes this user may see in lists, search, tags": their own plus
 * `users`-visible ones (tasklist G4). Admins get no extra reach here, matching the list.
 * Shared so list, search and tag queries cannot drift apart.
 */
export const readableBy = (userId: string) =>
  or(eq(recipe.ownerId, userId), eq(recipe.visibility, 'users'));
